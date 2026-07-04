// Agency-commission snapshot for the Profit tab.
//
// When a ScheduleLog (confirmed actual spend) is created, we freeze the client's
// current agency commission onto the row so historical profit never changes if
// the client's commission is edited later. COMMISSION -> `commissionRateAtEntry`
// holds the percentage; AOR -> it holds the fixed LKR fee. Both null when the
// client has no commission configured (that row earns 0 profit).
export function commissionSnapshot(client) {
  if (!client || !client.commissionType || client.commissionValue == null) {
    return { commissionTypeAtEntry: null, commissionRateAtEntry: null };
  }
  return {
    commissionTypeAtEntry: client.commissionType,
    commissionRateAtEntry: client.commissionValue,
  };
}
