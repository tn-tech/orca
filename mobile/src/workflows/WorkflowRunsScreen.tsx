import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { styles as screenStyles } from '../accounts/mobile-accounts-screen-styles'
import { loadHosts } from '../transport/host-store'
import { colors, spacing } from '../theme/mobile-theme'
import { useWorkflowRuns } from './use-workflow-runs'
import { WorkflowRunList } from './WorkflowRunList'
import { workflowStyles } from './workflow-run-styles'

function Placeholder({ busy, text }: { busy?: boolean; text: string }) {
  return (
    <View style={workflowStyles.placeholder}>
      {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
      <Text style={workflowStyles.meta}>{text}</Text>
    </View>
  )
}

/** FR-040 / US5: a host's workflow runs, with approvals and agent questions answerable here. */
export function WorkflowRunsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const { connState, runs, unsupported, error, refreshing, refresh, answer } =
    useWorkflowRuns(hostId)
  const [hostName, setHostName] = useState('')

  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void loadHosts().then((hosts) => {
      if (!stale) {
        setHostName(hosts.find((host) => host.id === hostId)?.name ?? '')
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  const connected = connState === 'connected'
  return (
    <SafeAreaView style={screenStyles.container} edges={['top']}>
      <View style={screenStyles.topRow}>
        <Pressable
          style={screenStyles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={screenStyles.titleWrap}>
          <Text style={screenStyles.heading}>Workflow runs</Text>
          {hostName ? (
            <Text style={screenStyles.subheading} numberOfLines={1}>
              {hostName}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={screenStyles.iconButton}
          onPress={refresh}
          disabled={!connected || refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh workflow runs"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <RefreshCw size={18} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[screenStyles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        {error && runs ? <Text style={workflowStyles.errorText}>{error}</Text> : null}
        {unsupported ? (
          <Placeholder text="This host doesn't offer workflow runs to mobile yet. Update Orca on the desktop to see them here." />
        ) : runs ? (
          <WorkflowRunList runs={runs} onAnswer={answer} />
        ) : error ? (
          <Placeholder text={error} />
        ) : (
          <Placeholder
            busy
            text={connected ? 'Loading workflow runs…' : `Connecting to ${hostName || 'host'}…`}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
