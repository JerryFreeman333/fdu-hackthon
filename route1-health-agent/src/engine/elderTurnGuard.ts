export function shouldCommitElderTurn(turnId: number, latestTurnId: number): boolean {
  return turnId === latestTurnId;
}
