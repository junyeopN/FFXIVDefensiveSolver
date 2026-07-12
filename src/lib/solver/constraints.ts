export class CooldownTracker {
  private lastUse = new Map<string, number>();

  private key(slot: string, skillId: string): string {
    return `${slot}:${skillId}`;
  }

  use(slot: string, skillId: string, timeMs: number): void {
    this.lastUse.set(this.key(slot, skillId), timeMs);
  }

  isReady(slot: string, skillId: string, timeMs: number, cooldownSec: number): boolean {
    const last = this.lastUse.get(this.key(slot, skillId));
    if (last === undefined) return true;
    return timeMs - last >= cooldownSec * 1000;
  }
}
