import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export const workflowStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  badge: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.statusAmber
  },
  prompt: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  meta: {
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  context: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    fontStyle: 'italic'
  },
  errorText: {
    fontSize: typography.metaSize,
    color: colors.statusRed
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgRaised
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  input: {
    minHeight: 72,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgBase,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    padding: spacing.sm,
    textAlignVertical: 'top'
  },
  runRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 2
  },
  runRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  runName: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.xl
  },
  promptGroup: {
    gap: spacing.xs
  },
  sectionHeading: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  runCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  placeholder: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl
  }
})
