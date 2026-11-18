import { Global, Module } from '@nestjs/common';

import { BrowserPool } from './browser.pool';
import { PlaywrightShalomDriver } from './playwright.driver';
import { SHALOM_DRIVER } from './tokens';

@Global()
@Module({
  providers: [
    BrowserPool,
    PlaywrightShalomDriver,
    { provide: SHALOM_DRIVER, useExisting: PlaywrightShalomDriver },
  ],
  exports: [SHALOM_DRIVER, BrowserPool],
})
export class ShalomModule {}
