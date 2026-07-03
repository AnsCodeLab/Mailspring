import { localized } from 'mailspring-exports';

export type SendPhase = 'idle' | 'retrieving' | 'waiting' | 'streaming';

// Status text for the pending assistant bubble. Never suggests cancelling -
// local models legitimately take minutes to load; Stop stays the user's call.
export function statusForPhase(phase: SendPhase, elapsedSec: number): string | null {
  if (phase === 'retrieving') return localized('Retrieving context…');
  if (phase === 'waiting') {
    if (elapsedSec >= 30) {
      return `${localized('Still waiting - local models can take a while to load.')} (${elapsedSec}s)`;
    }
    if (elapsedSec >= 10) return `${localized('Waiting for the model…')} (${elapsedSec}s)`;
    return localized('Waiting for the model…');
  }
  return null;
}

export function stopHighlighted(phase: SendPhase, elapsedSec: number): boolean {
  return phase === 'waiting' && elapsedSec >= 30;
}
