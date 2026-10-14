// DIY force gauge — ESP32 + HX711, speaking the Tindeq Progressor BLE protocol.
// See docs/force-gauge-ble.md for the protocol and the plan.
//
// Serial (115200) commands, for bench testing over USB:
//   t        tare (zero) the scale
//   c <kg>   calibrate: hang a known weight, then send e.g. "c 5"
//   s        toggle printing kg readings to serial
//   i        print status (calibration, sample rate, BLE)

#include <Arduino.h>
#include <HX711.h>
#include <NimBLEDevice.h>
#include <Preferences.h>

// ---- Hardware ----
static const int HX711_DT_PIN = 4;
static const int HX711_SCK_PIN = 5;
// Set to an ADC pin if a battery voltage divider is wired (2:1 assumed), else -1.
static const int BATTERY_PIN = -1;

// ---- Progressor protocol ----
#define SERVICE_UUID      "7e4e1701-1ea6-40c9-9dcc-13d34ffead57"
#define DATA_UUID         "7e4e1702-1ea6-40c9-9dcc-13d34ffead57"
#define CONTROL_UUID      "7e4e1703-1ea6-40c9-9dcc-13d34ffead57"
static const char *DEVICE_NAME = "Progressor_DIY";

static const uint8_t CMD_TARE = 0x64;
static const uint8_t CMD_START = 0x65;
static const uint8_t CMD_STOP = 0x66;
static const uint8_t CMD_SHUTDOWN = 0x6E;
static const uint8_t CMD_BATTERY = 0x6F;

static const uint8_t TAG_RESPONSE = 0x00;
static const uint8_t TAG_WEIGHT = 0x01;

// ---- State ----
HX711 scale;
Preferences prefs;

NimBLECharacteristic *dataChar = nullptr;
volatile bool connected = false;
volatile uint16_t peerMtu = 23;

long tareOffset = 0;
float countsPerKg = 1.0f;  // replaced by calibration
bool calibrated = false;

bool streaming = false;
uint32_t streamStartUs = 0;
bool serialPrint = false;

// Non-blocking tare: average the next TARE_SAMPLES raw readings.
static const int TARE_SAMPLES = 16;
int tareRemaining = 0;
int64_t tareSum = 0;

// Samples waiting to be sent in one notification.
static const int MAX_BATCH = 15;
struct Sample { float kg; uint32_t us; };
Sample batch[MAX_BATCH];
int batchCount = 0;
uint32_t batchStartMs = 0;

// Sample-rate measurement.
uint32_t rateWindowMs = 0;
int rateCount = 0;
float sampleHz = 0;

// Commands arrive on the BLE task; handle them on the main loop.
volatile int pendingCmd = -1;

// ---------------------------------------------------------------------------

void saveCalibration() {
  prefs.putLong("offset", tareOffset);
  prefs.putFloat("cpk", countsPerKg);
  prefs.putBool("cal", calibrated);
}

void loadCalibration() {
  tareOffset = prefs.getLong("offset", 0);
  countsPerKg = prefs.getFloat("cpk", 1.0f);
  calibrated = prefs.getBool("cal", false);
}

int maxSamplesPerPacket() {
  // ATT payload = MTU - 3; packet header = 2 bytes; each sample = 8 bytes.
  int n = ((int)peerMtu - 3 - 2) / 8;
  return constrain(n, 1, MAX_BATCH);
}

void sendPacket(uint8_t tag, const uint8_t *payload, uint8_t len) {
  if (!connected || !dataChar) return;
  uint8_t buf[2 + 255];
  buf[0] = tag;
  buf[1] = len;
  memcpy(buf + 2, payload, len);
  dataChar->setValue(buf, 2 + len);
  dataChar->notify();
}

void flushBatch() {
  if (batchCount == 0) return;
  uint8_t payload[MAX_BATCH * 8];
  for (int i = 0; i < batchCount; i++) {
    memcpy(payload + i * 8, &batch[i].kg, 4);      // float32 LE
    memcpy(payload + i * 8 + 4, &batch[i].us, 4);  // uint32 LE
  }
  sendPacket(TAG_WEIGHT, payload, batchCount * 8);
  batchCount = 0;
}

uint32_t readBatteryMv() {
  if (BATTERY_PIN < 0) return 4000;  // no divider wired: report "full-ish"
  return analogReadMilliVolts(BATTERY_PIN) * 2;
}

void startTare() {
  tareRemaining = TARE_SAMPLES;
  tareSum = 0;
}

void handleCommand(uint8_t cmd) {
  switch (cmd) {
    case CMD_TARE:
      startTare();
      break;
    case CMD_START:
      streaming = true;
      streamStartUs = micros();
      batchCount = 0;
      break;
    case CMD_STOP:
      flushBatch();
      streaming = false;
      break;
    case CMD_BATTERY: {
      uint32_t mv = readBatteryMv();
      sendPacket(TAG_RESPONSE, (uint8_t *)&mv, 4);
      break;
    }
    case CMD_SHUTDOWN:
      Serial.println("Shutdown requested — deep sleep (press RESET to wake)");
      delay(100);
      esp_deep_sleep_start();
      break;
    default:
      Serial.printf("Unknown command 0x%02X\n", cmd);
  }
}

// ---- BLE callbacks ----

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &info) override {
    connected = true;
    peerMtu = server->getPeerMTU(info.getConnHandle());
    Serial.println("BLE connected");
  }
  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &info, int reason) override {
    connected = false;
    streaming = false;
    peerMtu = 23;
    Serial.printf("BLE disconnected (reason %d), advertising again\n", reason);
    NimBLEDevice::startAdvertising();
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo &info) override {
    peerMtu = mtu;
  }
};

class ControlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &info) override {
    NimBLEAttValue v = c->getValue();
    if (v.length() > 0) pendingCmd = v[0];
  }
};

void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(247);
  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService *service = server->createService(SERVICE_UUID);
  dataChar = service->createCharacteristic(DATA_UUID, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *control = service->createCharacteristic(
      CONTROL_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  control->setCallbacks(new ControlCallbacks());
  service->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(SERVICE_UUID);
  adv->enableScanResponse(true);
  adv->start();
}

// ---- Serial commands ----

void printStatus() {
  Serial.printf("Calibrated: %s  counts/kg: %.2f  offset: %ld\n",
                calibrated ? "yes" : "NO", countsPerKg, tareOffset);
  Serial.printf("Sample rate: %.1f Hz %s\n", sampleHz,
                sampleHz > 0 && sampleHz < 20 ? "(HX711 RATE pin is low = 10 Hz mode)" : "");
  Serial.printf("BLE: %s  MTU: %u  streaming: %s\n",
                connected ? "connected" : "advertising", peerMtu, streaming ? "yes" : "no");
}

void handleSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  char c = line.charAt(0);
  if (c == 't') {
    startTare();
    Serial.println("Taring — keep the gauge unloaded...");
  } else if (c == 'c') {
    float kg = line.substring(1).toFloat();
    if (kg <= 0) {
      Serial.println("Usage: c <known kg>, e.g. c 5");
      return;
    }
    // Average a few readings with the known weight hanging.
    int64_t sum = 0;
    const int n = 20;
    for (int i = 0; i < n; i++) sum += scale.read();
    long loaded = sum / n;
    countsPerKg = (float)(loaded - tareOffset) / kg;
    calibrated = true;
    saveCalibration();
    Serial.printf("Calibrated: %.2f counts/kg (saved)\n", countsPerKg);
  } else if (c == 's') {
    serialPrint = !serialPrint;
  } else if (c == 'i') {
    printStatus();
  } else {
    Serial.println("Commands: t (tare), c <kg> (calibrate), s (toggle print), i (status)");
  }
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  prefs.begin("gauge", false);
  loadCalibration();
  scale.begin(HX711_DT_PIN, HX711_SCK_PIN);
  setupBle();

  Serial.println("\nDIY force gauge ready — advertising as Progressor_DIY");
  if (!calibrated) Serial.println("Not calibrated: send 't' unloaded, then hang a known weight and send 'c <kg>'");
  rateWindowMs = millis();
}

void loop() {
  handleSerial();

  int cmd = pendingCmd;
  if (cmd >= 0) {
    pendingCmd = -1;
    handleCommand((uint8_t)cmd);
  }

  if (scale.is_ready()) {
    long raw = scale.read();
    rateCount++;

    if (tareRemaining > 0) {
      tareSum += raw;
      if (--tareRemaining == 0) {
        tareOffset = tareSum / TARE_SAMPLES;
        saveCalibration();
        Serial.printf("Tared (offset %ld)\n", tareOffset);
      }
    }

    float kg = (float)(raw - tareOffset) / countsPerKg;

    if (serialPrint) Serial.printf("%.2f kg\n", kg);

    if (streaming && connected) {
      if (batchCount == 0) batchStartMs = millis();
      batch[batchCount++] = {kg, micros() - streamStartUs};
      if (batchCount >= maxSamplesPerPacket()) flushBatch();
    }
  }

  // Don't hold samples longer than 50 ms, so the app's live view stays snappy.
  if (batchCount > 0 && millis() - batchStartMs > 50) flushBatch();

  uint32_t now = millis();
  if (now - rateWindowMs >= 1000) {
    sampleHz = rateCount * 1000.0f / (now - rateWindowMs);
    rateCount = 0;
    rateWindowMs = now;
  }
}
