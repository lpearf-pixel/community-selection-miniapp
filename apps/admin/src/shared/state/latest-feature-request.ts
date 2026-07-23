export type LatestFeatureRequestTicket = {
  controller: AbortController;
  generation: number;
  isCurrent: () => boolean;
};

export type LatestFeatureRequestResult<T> =
  | { discarded: true }
  | { discarded: false; data: T };

export async function settleLatestFeatureRequest<T>(
  ticket: LatestFeatureRequestTicket,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<LatestFeatureRequestResult<T>> {
  try {
    const data = await load(ticket.controller.signal);
    return ticket.isCurrent()
      ? { discarded: false, data }
      : { discarded: true };
  } catch (error) {
    if (!ticket.isCurrent()) return { discarded: true };
    throw error;
  }
}
