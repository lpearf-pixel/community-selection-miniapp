import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';

const target = (testId: string, description: string) => ({
  description,
  renderSelector: `[data-testid="${testId}"]`,
});

export class AfterSalesPage extends MiniappPageObject {
  readonly route = 'pages/after-sales/apply/index';

  async submit(reason: string): Promise<MiniProgramPage> {
    const page = await this.current();
    await this.driver.waitForData(page, 'can_submit', Boolean, {
      description: 'after-sale refundable state',
    });
    await this.input(page, target('after-sale-reason', 'after-sale reason'), reason);
    await this.tap(page, target('after-sale-submit', 'after-sale submit'));
    return this.driver.waitForRoute('pages/after-sales/detail/index');
  }
}
