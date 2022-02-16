const NOT_FOUND_INDEX = -1;

export type ShutdownFunc = () => Promise<void>;

export class ShutdownHandler {
  private readonly shutdownFuncs: ShutdownFunc[] = [];
  private shutdownTriggered = false;

  public addFunction(func: ShutdownFunc): void {
    this.shutdownFuncs.push(func);
  }

  public removeFunction(func: ShutdownFunc): void {
    const index = this.shutdownFuncs.indexOf(func);
    if (index !== NOT_FOUND_INDEX) {
      this.shutdownFuncs.splice(index, 1);
    }
  }

  public async shutdown(): Promise<void> {
    if (this.shutdownTriggered) {
      return;
    }
    this.shutdownTriggered = true;

    await Promise.allSettled(this.shutdownFuncs.map(async (func) => func()));
  }
}
