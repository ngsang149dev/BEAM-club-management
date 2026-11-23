export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentMs: number;

  constructor(initialTime: Date | string = '2026-01-01T00:00:00.000Z') {
    const parsed =
      initialTime instanceof Date ? initialTime.getTime() : Date.parse(initialTime);
    if (Number.isNaN(parsed)) {
      throw new Error('Invalid initialTime for FakeClock');
    }
    this.currentMs = parsed;
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  setNow(nextTime: Date | string): void {
    const parsed = nextTime instanceof Date ? nextTime.getTime() : Date.parse(nextTime);
    if (Number.isNaN(parsed)) {
      throw new Error('Invalid nextTime for FakeClock');
    }
    this.currentMs = parsed;
  }

  advanceByMs(ms: number): void {
    this.currentMs += ms;
  }
}
