// One line saying what failed, with "Try again" (spec 15 section 0.7).
import { Banner } from '@/components/ui/banner';

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Banner tone="danger" message={message} action={{ label: 'Try again', onPress: onRetry }} />;
}
