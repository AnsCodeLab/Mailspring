import { applyToolbarChromeFloor, GLOBAL_TOOLBAR_CHROME_MIN_WIDTH } from '../src/sheet';

describe('applyToolbarChromeFloor', () => {
  it('raises the last column minWidth to the toolbar chrome floor when it is smaller', () => {
    const columns = [{ minWidth: 165 }, { minWidth: 100 }];
    const out = applyToolbarChromeFloor(columns);
    expect(out[0].minWidth).toBe(165);
    expect(out[1].minWidth).toBe(GLOBAL_TOOLBAR_CHROME_MIN_WIDTH);
  });

  it('leaves the last column minWidth alone when it already exceeds the floor', () => {
    const bigMinWidth = GLOBAL_TOOLBAR_CHROME_MIN_WIDTH + 500;
    const columns = [{ minWidth: 165 }, { minWidth: bigMinWidth }];
    const out = applyToolbarChromeFloor(columns);
    expect(out[1].minWidth).toBe(bigMinWidth);
  });

  it('does not touch non-last columns', () => {
    const columns = [{ minWidth: 50 }, { minWidth: 60 }, { minWidth: 70 }];
    const out = applyToolbarChromeFloor(columns);
    expect(out[0].minWidth).toBe(50);
    expect(out[1].minWidth).toBe(60);
    expect(out[2].minWidth).toBe(GLOBAL_TOOLBAR_CHROME_MIN_WIDTH);
  });

  it('does nothing for an empty column list', () => {
    expect(applyToolbarChromeFloor([])).toEqual([]);
  });
});
