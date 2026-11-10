import {
  AddBar, Body, Card, CardTitle, CollapsibleBlockCard, DayCircle, GhostButton, HeadlineInput, IconButton,
  ListRow, Melt, MintButton, Mono, NavBar, PaperScreen, PaperSwitch, PosterHeadline, PrimaryCTA,
  ProgressBar, SectionHeader, SelectValue, SettingsRow, SpecsRow, Stepper, TextField, TimelineLegend,
  usePaper, usePaperPreference, WeekPill,
} from "@/components/paper"
import type { DayState } from "@/components/paper"
import { useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useState } from "react"
import { View } from "react-native"

// Every Paper Mint component on one screen (docs/design-system.md).
// Open with: xcrun simctl openurl booted testapp://paper-preview
export default function PaperPreview() {
  const t = usePaper()
  const router = useRouter()
  const { preference, setPreference } = usePaperPreference()
  const [open, setOpen] = useState(0)
  const [homework, setHomework] = useState(true)
  const [coached, setCoached] = useState(false)
  const [reps, setReps] = useState(6)
  const [name, setName] = useState("")
  const [note, setNote] = useState("")

  const week: DayState[] = ["trained", "trained", "homework", "today", "upcoming", "upcoming", "upcoming"]

  return (
    <PaperScreen
      header={
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 }}>
          <Body weight={800} size={22}>Hi, Federico</Body>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <MintButton compact icon="add" label="Sequence" onPress={() => {}} />
            <IconButton icon="close" label="Close preview" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          </View>
        </View>
      }
    >
      <StatusBar style={t.mode === "dark" ? "light" : "dark"} />

      {/* Appearance */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {(["system", "light", "dark"] as const).map((p) =>
          preference === p ? (
            <MintButton key={p} compact label={cap(p)} onPress={() => {}} />
          ) : (
            <GhostButton key={p} compact label={cap(p)} onPress={() => setPreference(p)} />
          )
        )}
      </View>

      {/* Poster + melt */}
      <View style={{ marginTop: 28 }}>
        <Melt top={60} />
        <Mono>This week&apos;s focus</Mono>
        <PosterHeadline style={{ marginTop: 8 }}>Power endurance</PosterHeadline>
        <SpecsRow left={["Week *3* of 6", "Nov 10 – Nov 16"]} right={["*4* days left", "On track"]} />
      </View>

      <View style={{ gap: 12, marginTop: 56 }}>
        <Card homework>
          <CardTitle>Hangboard repeaters</CardTitle>
          <Body muted size={14} style={{ marginTop: 4 }}>From your coach · 20 min</Body>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            <MintButton label="Start" icon="play" onPress={() => {}} />
            <GhostButton label="Pick a day" onPress={() => {}} />
          </View>
        </Card>

        <Card eyebrow="Today's sequence">
          <CardTitle size={34}>Limit bouldering</CardTitle>
          <View style={{ marginTop: 10 }}>
            <ListRow index={1} icon="flame" label="Warm-up" detail="15 min · ramp up" />
            <ListRow index={2} icon="trending-up" label="Project bouldering" detail="3 × 15 min" />
            <ListRow index={3} icon="barbell" label="Strength" detail="Pull-ups · 4 × 5" last />
          </View>
        </Card>

        <PrimaryCTA label="Start workout" onPress={() => {}} />
      </View>

      <SectionHeader>Your training plan</SectionHeader>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <WeekPill>Week 3 of 6</WeekPill>
          <Mono>Oct 27 – Dec 7</Mono>
        </View>
        <ProgressBar progress={0.42} style={{ marginTop: 14 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
          {week.map((s, i) => (
            <View key={i} style={{ alignItems: "center", gap: 6 }}>
              <Mono size={9.5}>{"MTWTFSS"[i]}</Mono>
              <DayCircle state={s} label={String(10 + i)} />
            </View>
          ))}
        </View>
        <TimelineLegend />
      </Card>

      <SectionHeader>Editor pieces</SectionHeader>
      <Card padded={false} style={{ overflow: "hidden" }}>
        <NavBar title="New workout" status="Creating · unsaved" onCancel={() => {}} onSave={() => {}} />
        <View style={{ padding: 18, gap: 16 }}>
          <HeadlineInput value={name} onChangeText={setName} />
          <TextField label="Notes" placeholder="Anything to remember" value={note} onChangeText={setNote} />
          <Stepper label="Reps" value={reps} onChange={setReps} min={1} max={20} />
        </View>
      </Card>

      <Card style={{ marginTop: 12 }} padded={false}>
        <View style={{ paddingHorizontal: 18 }}>
          <SettingsRow icon="git-branch" title="Based on" description="Start from a saved workout" trailing={<SelectValue value="None" />} />
          <SettingsRow icon="school" title="Homework" description="Athlete does it on their own" trailing={<PaperSwitch label="Homework" value={homework} onValueChange={setHomework} />} />
          <SettingsRow icon="person" title="Coached" description="You run it in class" trailing={<PaperSwitch label="Coached" value={coached} onValueChange={setCoached} />} />
          <SettingsRow icon="add-circle" title="Exercises" description="Add from the library" trailing={<GhostButton compact tone="mint" label="Add" onPress={() => {}} />} last />
        </View>
      </Card>

      <SectionHeader>Blocks · 3</SectionHeader>
      <View style={{ gap: 12 }}>
        {[
          { cat: "Warm-up", title: "Progressive ramp", dot: t.blockBlue },
          { cat: "Main", title: "Limit bouldering", dot: t.mint },
          { cat: "Strength", title: "Weighted pull-ups", dot: t.ink },
        ].map((b, i) => (
          <CollapsibleBlockCard key={i} category={b.cat} title={b.title} dotColor={b.dot} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} onDrag={() => {}}>
            <Body muted size={14}>Block settings go here.</Body>
          </CollapsibleBlockCard>
        ))}
        <AddBar label="Add block" onPress={() => {}} />
      </View>
    </PaperScreen>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
