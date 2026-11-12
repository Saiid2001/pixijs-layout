/*
 * Opposite insets size a box only where it is absolutely positioned.
 *
 * Run with `npx tsx --test tests/node/applyStyle.test.ts`. CSS 2.1 10.3.7 and
 * 10.6.4 size an absolute box from left/right and top/bottom; a relatively
 * positioned one keeps its own width and height and is only shifted (9.4.3).
 * The full-bleed pattern -- `position: relative; left: 50%; right: 50%;
 * margin: 0 -50vw; width: 100vw` -- lost its width and was stretched across
 * its parent and both negative margins.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Yoga from 'yoga-layout';
import { applyStyle } from '../../src/core/style/applyStyle';

function laidOut(style: any): { width: number; height: number } {
    const root = Yoga.Node.create();

    root.setWidth(1000);
    root.setHeight(1000);

    const child = Yoga.Node.create();

    applyStyle(child, style);
    root.insertChild(child, 0);
    root.calculateLayout(1000, 1000);

    return { width: child.getComputedWidth(), height: child.getComputedHeight() };
}

void test('a relative box with left and right keeps its declared width and height', () => {
    const box = laidOut({ position: 'relative', left: 10, right: 10, top: 5, bottom: 5, width: 300, height: 40 });

    assert.equal(box.width, 300);
    assert.equal(box.height, 40);
});

void test('an absolute box with left and right is sized by them', () => {
    const box = laidOut({ position: 'absolute', left: 100, right: 100, top: 10, bottom: 10, width: 300, height: 40 });

    assert.equal(box.width, 800);
    assert.equal(box.height, 980);
});
