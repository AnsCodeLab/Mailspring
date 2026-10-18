import { CategoryStore, Message } from 'mailspring-exports';
import AutoloadImagesStore from '../lib/autoload-images-store';

describe('AutoloadImagesStore.shouldBlockImagesIn', function () {
  const spamFolder = { id: 'spam-folder' };

  function messageWith(folder: { id: string } | undefined) {
    return {
      accountId: 'a1',
      id: 'm1',
      folder,
      body: '<img src="https://example.com/x.png">',
      fromContact: () => ({ email: 'sender@example.com' }),
    } as unknown as Message;
  }

  beforeEach(function () {
    spyOn(AppEnv.config, 'get').andCallFake((key: string) =>
      key === 'core.reading.autoloadImages' ? true : undefined
    );
  });

  it('does not throw for a message whose folder is not resolved yet', function () {
    spyOn(CategoryStore, 'getSpamCategory').andReturn(spamFolder as never);
    expect(AutoloadImagesStore.shouldBlockImagesIn(messageWith(undefined))).toBe(false);
  });

  it('does not throw when there is no spam folder and the message has no folder', function () {
    spyOn(CategoryStore, 'getSpamCategory').andReturn(undefined);
    expect(AutoloadImagesStore.shouldBlockImagesIn(messageWith(undefined))).toBe(false);
  });

  it('still blocks images for a message in the spam folder', function () {
    spyOn(CategoryStore, 'getSpamCategory').andReturn(spamFolder as never);
    expect(AutoloadImagesStore.shouldBlockImagesIn(messageWith(spamFolder))).toBe(true);
  });
});
