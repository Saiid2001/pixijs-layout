import {
    Container,
    type ContainerChild,
    type ContainerOptions,
    type DestroyOptions,
    Graphics,
    type IRenderLayer,
    Ticker,
} from 'pixi.js';
import { BoxSizing, Edge } from 'yoga-layout/load';
import { type ComputedLayout } from '../core/types';
import { Trackpad, type TrackpadOptions } from './trackpad/Trackpad';

/**
 * Options for configuring the layout container.
 * @property {TrackpadOptions} [trackpad] - Options to configure the trackpad for scrolling
 */
export interface LayoutContainerOptions extends ContainerOptions {
    /** Options to configure the trackpad for scrolling */
    trackpad?: TrackpadOptions;
    /** A container to be used for the background */
    background?: ContainerChild;
}

/**
 * A specialized container that serves as an overflow container for scrolling content.
 */
export interface OverflowContainer extends Container {
    isOverflowContainer: boolean;
}

/**
 * A container that behaves like an HTML div element with flexbox-style layout capabilities.
 *
 * Supports objectFit, objectPosition, backgroundColor, borderColor, and overflow
 *
 * @example
 * ```typescript
 * // Create a container with background and border
 * const container = new LayoutContainer();
 * container.layout = {
 *     width: 300,
 *     height: 200,
 *     backgroundColor: 0xFF0000,
 *     borderWidth: 2,
 *     borderColor: 0x000000,
 *     borderRadius: 8,
 *     padding: 16,
 *     flexDirection: 'row',
 *     justifyContent: 'center',
 *     alignItems: 'center',
 * };
 *
 * // Create child elements
 * const child1 = new Container();
 * child1.layout = { flex: 1 };
 * const child2 = new Container();
 * child2.layout = { flex: 2 };
 *
 * // Add children which will be positioned using flex layout
 * container.addChild(child1, child2);
 * ```
 */
export class LayoutContainer extends Container {
    /** The container that holds the overflow content */
    public overflowContainer: OverflowContainer = new Container({
        label: 'overflowContainer',
    }) as OverflowContainer;

    /** The trackpad for handling scrolling, made when one is first needed */
    protected _trackpadInstance: Trackpad | null = null;
    protected _trackpadOptions: TrackpadOptions | undefined;

    /**
     * The trackpad that scrolls this container, and the pointer listeners it
     * reads. Built on first use: a container that scrolls is a small minority
     * of them, and giving every one a trackpad and six listeners was the
     * single largest cost of building a large page — a fifth of the time
     * iana.org/protocols took to load, which is 35,657 elements.
     */
    protected get _trackpad(): Trackpad {
        if (this._trackpadInstance) {
            return this._trackpadInstance;
        }

        const trackpad = new Trackpad({
            constrain: true,
            ...this._trackpadOptions,
        });

        this._trackpadInstance = trackpad;

        this.on('pointerdown', (e) => trackpad.pointerDown(e.global));
        this.on('pointerup', () => trackpad.pointerUp());
        this.on('pointerupoutside', () => trackpad.pointerUp());
        this.on('pointermove', (e) => trackpad.pointerMove(e.global));
        this.on('pointercancel', () => trackpad.pointerUp());
        this.on('wheel', (e) => {
            const overflow = this.layout?.style.overflow;

            if (overflow !== 'scroll') {
                return;
            }
            const shift = e.shiftKey ? 1 : 0;
            const deltaX = e.deltaX * (shift ? 1 : -1);
            const deltaY = e.deltaY * (shift ? -1 : 1);

            const targetX = trackpad.xAxis.value - deltaX;
            const targetY = trackpad.yAxis.value - deltaY;

            trackpad.xAxis.value = Math.max(trackpad.xAxis.max, Math.min(trackpad.xAxis.min, targetX));
            trackpad.yAxis.value = Math.max(trackpad.yAxis.max, Math.min(trackpad.yAxis.min, targetY));
        });

        return trackpad;
    }

    // The background, the border stroke and the overflow mask are each created
    // the first time something asks to draw one. Most containers never paint
    // any of them, and allocating all three up front put three objects that
    // draw nothing into the scene for every box on the page — on a long article
    // that was 115,000 of the 220,000 objects in the tree, two thirds of them
    // empty, and everything that walks the scene paid for them on every frame.
    private _background: Container | Graphics | null = null;
    private _stroke: Graphics | null = null;
    private _mask: Graphics | null = null;

    /** Whether or not the background was created by the user */
    private _isUserBackground: boolean = false;

    /** The background, created on first use. */
    public get background(): Container | Graphics {
        if (!this._background) {
            this._background = new Graphics({ label: 'background' });
            // Behind the content, which is the first child otherwise.
            super.addChildAt(this._background, 0);
        }

        return this._background;
    }

    public set background(value: Container | Graphics) {
        if (this._background) {
            super.removeChild(this._background);
        }

        this._background = value;
        super.addChildAt(value, 0);
    }

    /** The border stroke, created on first use. */
    public get stroke(): Graphics {
        if (!this._stroke) {
            this._stroke = new Graphics({ label: 'stroke' });
            // In front of everything else.
            super.addChild(this._stroke);
        }

        return this._stroke;
    }

    /** The overflow mask, created on first use. */
    private get _overflowMask(): Graphics {
        if (!this._mask) {
            this._mask = new Graphics();
            super.addChild(this._mask);
        }

        return this._mask;
    }

    constructor(params: LayoutContainerOptions = {}) {
        const { layout, trackpad, background, ...options } = params;

        super(options);
        this.layout = layout ?? {};

        this.overflowContainer.isOverflowContainer = true;

        super.addChild(this.overflowContainer);

        if (background) {
            this._isUserBackground = true;
            this.background = background;
        }

        this.addChild = this._addChild;
        this.removeChild = this._removeChild;

        this._trackpadOptions = trackpad;
        this.eventMode = 'static';
        Ticker.shared.add(this.update, this);
    }

    protected _addChild<U extends (ContainerChild | IRenderLayer)[]>(..._children: U): U[0] {
        return this.overflowContainer.addChild(..._children);
    }

    protected _removeChild<U extends (ContainerChild | IRenderLayer)[]>(..._children: U): U[0] {
        return this.overflowContainer.removeChild(..._children);
    }

    /**
     * Computes the layout data for this container based on yoga calculations and draws the background.
     * @param computedLayout - The computed layout data from yoga
     * @returns Position and scale information for the container
     * @internal
     */
    override computeLayoutData(computedLayout: ComputedLayout) {
        this._drawBackground(computedLayout);

        return {
            x: computedLayout.left,
            y: computedLayout.top,
            offsetX: 0,
            offsetY: 0,
            scaleX: 1,
            scaleY: 1,
        };
    }

    /**
     * Updates the container mask based on overflow settings
     * @param width - Container width
     * @param height - Container height
     * @param radius - Border radius
     */
    protected _updateMask(width: number, height: number, radius: number = 0) {
        const mask = this._overflowMask;

        mask.clear();

        // A collapsed box clips everything away, and an empty mask says exactly
        // that. Carrying on would pass a negative size to roundRect below and
        // hand the tessellator degenerate geometry, which throws.
        if (width <= 0 || height <= 0) {
            return;
        }

        mask.roundRect(0, 0, width, height, radius);
        mask.fill(0x0000ff);

        // The inset rect only exists on a box big enough to have one.
        if (width > 2 && height > 2) {
            mask.roundRect(1, 1, width - 2, height - 2, radius);
            mask.cut();
            mask.roundRect(1, 1, width - 2, height - 2, radius);
            mask.fill(0x00ff00);
            mask.cut();
        }
    }

    protected _updateBackground(computedLayout: ComputedLayout) {
        const layoutStyles = this.layout!.style;
        const { backgroundColor, borderRadius } = layoutStyles;

        if (this._isUserBackground) {
            this.background.position.set(0, 0);
            this.background.setSize(computedLayout.width, computedLayout.height);
        } else {
            // Nothing to paint and nothing painted before: leave it uncreated.
            // eslint-disable-next-line no-eq-null, eqeqeq
            if (backgroundColor == null && !this._background) {
                return;
            }

            const background = this.background as Graphics;

            background.clear();
            background.roundRect(0, 0, computedLayout.width, computedLayout.height, borderRadius ?? 0);
            // eslint-disable-next-line no-eq-null, eqeqeq
            if (backgroundColor != null) {
                background.fill({ color: backgroundColor });
            }
        }
    }

    /**
     * Draws the container's background including:
     * - Background color
     * - Border
     * - Border radius
     *
     * @param computedLayout - The computed layout data from yoga
     * @protected
     */
    protected _drawBackground(computedLayout: ComputedLayout) {
        const yoga = this.layout!.yoga;

        // Inside the box, always: Yoga's computed layout is the border box under
        // either box sizing -- content-box adds the border to the size asked for
        // rather than leaving it outside -- so a stroke aligned outwards drew the
        // border beyond the box it belongs to and grew the element by its width.
        const alignment = 1;

        // Yoga answers getBorder(Edge.All) only where the border was set on that
        // edge, and returns null for one given per side. A layout built from CSS
        // has the per-side form -- a stylesheet's border resolves to its four
        // sides -- so the computed edges are the only ones that answer, and
        // asking Edge.All alone drew no border at all for such a box.
        const top = yoga.getComputedBorder(Edge.Top) || 0;
        const right = yoga.getComputedBorder(Edge.Right) || 0;
        const bottom = yoga.getComputedBorder(Edge.Bottom) || 0;
        const left = yoga.getComputedBorder(Edge.Left) || 0;

        const layoutStyles = this.layout!.style;
        const { borderColor, borderRadius } = layoutStyles;

        this._updateBackground(computedLayout);

        // eslint-disable-next-line no-eq-null, eqeqeq
        const hasBorder = (top > 0 || right > 0 || bottom > 0 || left > 0) && borderColor != null;
        const uniform = top === right && right === bottom && bottom === left;

        if (hasBorder || this._stroke) {
            this.stroke.clear();

            if (hasBorder && uniform) {
                this.stroke.roundRect(0, 0, computedLayout.width, computedLayout.height, borderRadius ?? 0);
                this.stroke.stroke({ color: borderColor, width: top, alignment });
            } else if (hasBorder) {
                // Sides of unequal width are not one stroke: each is the band it
                // covers along its own edge, drawn inside the box. A radius does
                // not apply to these, and neither does a per-side colour -- the
                // style carries one colour for the whole border.
                const { width, height } = computedLayout;

                if (top > 0) this.stroke.rect(0, 0, width, top);
                if (bottom > 0) this.stroke.rect(0, height - bottom, width, bottom);
                if (left > 0) this.stroke.rect(0, top, left, Math.max(0, height - top - bottom));
                if (right > 0) this.stroke.rect(width - right, top, right, Math.max(0, height - top - bottom));

                this.stroke.fill({ color: borderColor });
            }
        }

        // Handle overflow
        const overflow = this.layout?.style.overflow;

        if (overflow !== 'visible') {
            this._updateMask(computedLayout.width, computedLayout.height, layoutStyles.borderRadius ?? 0);
            this.setMask({ mask: this._overflowMask });
            // the max value is actually the difference between the container size and the content size and the stroke
            const borderOffset = yoga.getBoxSizing() === BoxSizing.BorderBox ? top : 0;

            setTimeout(() => {
                const maskWidth = computedLayout.width - this.overflowContainer.width - borderOffset * 2;
                const maskHeight = computedLayout.height - this.overflowContainer.height - borderOffset * 2;

                this._trackpad.xAxis.max = Math.min(0, maskWidth);
                this._trackpad.yAxis.max = Math.min(0, maskHeight);
            }, 1);
        } else {
            this.mask = null;

            // Read rather than asked for: a container that does not clip has
            // nothing to scroll, and asking would build the trackpad that not
            // building is the point of.
            if (this._trackpadInstance) {
                this._trackpadInstance.xAxis.value = 0;
                this._trackpadInstance.yAxis.value = 0;
            }

            this.overflowContainer.position.set(0, 0);
        }
    }

    protected update(): void {
        const overflow = this.layout?.style.overflow;

        if (overflow !== 'scroll') {
            return;
        }
        this._trackpad.update();

        // The trackpad reports null until its bounds have been measured, and
        // writing that into a position makes the transform NaN. NaN spreads to
        // every descendant's world transform, so a container that had not been
        // scrolled yet erased its own contents the moment a frame ticked.
        const { x, y } = this._trackpad;

        this.overflowContainer.x = Number.isFinite(x) ? x : 0;
        this.overflowContainer.y = Number.isFinite(y) ? y : 0;
    }

    public override destroy(options?: DestroyOptions): void {
        super.destroy(options);
        Ticker.shared.remove(this.update, this);
    }
}
