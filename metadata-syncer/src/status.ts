export function computeEventStatus(event: { active?: boolean; closed?: boolean }): string {
  if (event.closed) return 'closed';
  if (event.active) return 'open';
  return 'open';
}

export function computeMarketStatus(market: {
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  umaResolutionStatuses?: any[];
  automaticallyResolved?: boolean;
}): string {
  // Parse statuses if string
  let statuses = market.umaResolutionStatuses || [];
  if (typeof statuses === 'string') {
    try { statuses = JSON.parse(statuses); } catch { statuses = []; }
  }

  if (Array.isArray(statuses) && statuses.some((s: any) => s === 'proposed' || s?.status === 'proposed')) {
    return 'resolution_proposed';
  }
  if (market.closed && !market.active) return 'closed';
  if (market.active && market.acceptingOrders === false) return 'paused';
  return 'open';
}

export function isSettled(market: {
  umaResolutionStatuses?: any[];
  automaticallyResolved?: boolean;
}): boolean {
  let statuses = market.umaResolutionStatuses || [];
  if (typeof statuses === 'string') {
    try { statuses = JSON.parse(statuses); } catch { statuses = []; }
  }
  if (market.automaticallyResolved) return true;
  return Array.isArray(statuses) && statuses.some((s: any) => s === 'settled' || s?.status === 'settled');
}
