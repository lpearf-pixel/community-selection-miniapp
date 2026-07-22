import type { ElementTarget } from './driver.js';
import type { MiniappDriver } from './driver.js';
import type { MiniProgramPage } from './ports.js';

export abstract class MiniappPageObject {
  protected readonly driver: MiniappDriver;
  abstract readonly route: string;

  constructor(driver: MiniappDriver) {
    this.driver = driver;
  }

  async current(options: { timeoutMs?: number } = {}): Promise<MiniProgramPage> {
    return this.driver.waitForRoute(this.route, options);
  }

  async tap(page: MiniProgramPage, target: ElementTarget): Promise<void> {
    await this.driver.tap(page, target);
  }

  async input(page: MiniProgramPage, target: ElementTarget, value: string): Promise<void> {
    await this.driver.input(page, target, value);
  }
}
