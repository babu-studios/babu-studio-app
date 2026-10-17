import { powerSaveBlocker } from "electron";

/** Reference-counted blocker that keeps the system awake while recording or exporting. */
export class PowerGuard {
  private blockerId: number | null = null;
  private holders = 0;

  acquire(): () => void {
    this.holders += 1;
    if (this.blockerId === null) {
      this.blockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.holders -= 1;
      if (this.holders === 0 && this.blockerId !== null) {
        powerSaveBlocker.stop(this.blockerId);
        this.blockerId = null;
      }
    };
  }
}

export const powerGuard = new PowerGuard();
