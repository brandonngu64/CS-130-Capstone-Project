// Detects when two tabs in the same browser end up with the same peer id
// (most commonly caused by Chrome's "Duplicate Tab" copying sessionStorage).
// If a collision is detected within the listen window, the later-claiming tab
// is asked to regenerate its peer id before joining a room.

const CHANNEL_NAME = 'cs130-peer-id-claim';
const LISTEN_WINDOW_MS = 250;

type ClaimMessage = {
  peerId: string;
  claimedAt: number;
};

export type PeerIdClaim = {
  /** Resolves with the peer id this tab should actually use. */
  readonly resolved: Promise<string>;
  /** Stops listening once a room is joined. */
  dispose(): void;
};

/**
 * Broadcasts a claim for `initialPeerId`. If another tab broadcasts the same
 * id with an earlier `claimedAt` within the listen window, `regenerate()` is
 * called to produce a fresh id for this tab. The returned promise resolves
 * with the final id (either the original or the regenerated replacement).
 */
export function claimPeerId(
  initialPeerId: string,
  regenerate: () => string,
): PeerIdClaim {
  let resolvedPeerId = initialPeerId;
  let channel: BroadcastChannel | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const channelCtor =
    typeof globalThis.BroadcastChannel === 'function' ? globalThis.BroadcastChannel : null;

  const resolved = new Promise<string>((resolve) => {
    if (!channelCtor) {
      resolve(resolvedPeerId);
      return;
    }

    try {
      channel = new channelCtor(CHANNEL_NAME);
    } catch {
      resolve(resolvedPeerId);
      return;
    }

    const myClaimedAt = performance.now();

    const finish = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
        channel = null;
      }
      resolve(resolvedPeerId);
    };

    channel.onmessage = (event: MessageEvent<ClaimMessage>): void => {
      const data = event.data;
      if (!data || typeof data.peerId !== 'string') {
        return;
      }
      if (data.peerId !== resolvedPeerId) {
        return;
      }
      // Collision. The tab with the earlier claim wins; the later one regenerates.
      if (data.claimedAt < myClaimedAt) {
        const replacement = regenerate();
        resolvedPeerId = replacement;
        if (channel) {
          try {
            channel.postMessage({ peerId: replacement, claimedAt: performance.now() });
          } catch {
            // ignore
          }
        }
      }
    };

    try {
      channel.postMessage({ peerId: resolvedPeerId, claimedAt: myClaimedAt });
    } catch {
      // ignore
    }

    timeoutId = setTimeout(finish, LISTEN_WINDOW_MS);
  });

  return {
    resolved,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
        channel = null;
      }
    },
  };
}
