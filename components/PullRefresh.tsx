import { freshReads } from "@/utils/readCache"
import { useC } from "@/theme/paper/legacy"
import { useCallback, useState } from "react"
import { RefreshControl } from "react-native"

// Pull-to-refresh for a screen's ScrollView / FlatList: reads past the
// few-minute read cache (utils/readCache.ts), so someone else's change
// (an athlete's workout, a coach's edit) shows right away.
export function usePullRefresh(load: () => unknown) {
  const C = useC()
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    freshReads()
    try { await load() } catch (e) { console.error(e) } finally { setRefreshing(false) }
  }, [load])
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.green} colors={[C.green]} />
}
