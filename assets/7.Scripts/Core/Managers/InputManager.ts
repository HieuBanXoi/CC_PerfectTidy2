import { _decorator, EventTouch, EventMouse, Input, input, Node, UITransform, Vec2, Vec3, math, view } from 'cc';
import { Ply_Singleton } from '../../Gameplay/Framework/Ply_Singleton';
import { GameManager } from '../../Gameplay/Systems/GameManager';
import { ItemDraggable } from '../../Gameplay/Items/Components/ItemDraggable';
import { ItemStirring } from '../../Gameplay/Items/Components/ItemStirring';
import { ItemClickable } from '../../Gameplay/Items/Components/ItemClickable';
import { ItemSnap, ItemState } from '../../Gameplay/Items/Snapping/ItemSnap';
import { ui } from './UI';
import { Ply_SoundManager } from '../../Gameplay/Framework/Ply_SoundManager';
import { HandTutManager } from '../../Gameplay/Systems/HandTutManager';
const { ccclass, property } = _decorator;

export var ipm: InputManager | null = null;

@ccclass('InputManager')
export class InputManager extends Ply_Singleton<InputManager> {

    static instance: InputManager | null = null;

    @property({ type: Node, tooltip: 'Container node for dragged items; it renders them above normal gameplay.' })
    public draggingNode: Node = null!;

    @property
    public isDragging = false;

    @property({ readonly: true, tooltip: 'True while gameplay input is temporarily locked.' })
    public isInputLocked = false;

    // --- Unified Screen Drag & Zoom Target ---
    @property({ type: Node, tooltip: 'Target node dùng chung cho cả Drag (kéo) và Zoom (phóng to/thu nhỏ) (ví dụ: Node World / Level)' })
    public screenTarget: Node = null!;

    @property({ tooltip: 'Bật tính năng kéo màn hình khi không tương tác với item' })
    public enableScreenDrag: boolean = true;

    @property({ tooltip: 'Giới hạn vùng kéo màn hình (Min / Max bounds)' })
    public enableScreenDragBounds: boolean = true;

    @property({ tooltip: 'Tọa độ tối thiểu (Min X, Min Y) cho screenTarget ở tỉ lệ baseZoomScale' })
    public minDragPosition: Vec2 = new Vec2(-500, -500);

    @property({ tooltip: 'Tọa độ tối đa (Max X, Max Y) cho screenTarget ở tỉ lệ baseZoomScale' })
    public maxDragPosition: Vec2 = new Vec2(500, 500);

    @property({ tooltip: 'Tỉ lệ zoom chuẩn (mốc base, mặc định 1.0) dùng để tính giới hạn kéo động theo zoom scale' })
    public baseZoomScale: number = 1.0;

    @property({ tooltip: 'Tốc độ kéo màn hình' })
    public screenDragSpeed: number = 1.0;

    @property({ tooltip: 'Distance from a screen edge that starts auto-panning while an item is dragged.' })
    public itemDragScreenEdgeSize: number = 100;

    @property({ tooltip: 'Maximum auto-pan speed while a dragged item is at a screen edge.' })
    public itemDragScreenEdgeSpeed: number = 500;

    @property({ tooltip: 'Khóa kéo trục X' })
    public lockScreenDragX: boolean = false;

    @property({ tooltip: 'Khóa kéo trục Y' })
    public lockScreenDragY: boolean = false;

    // --- Pinch Zoom Settings ---
    @property({ tooltip: 'Bật tính năng zoom 2 ngón tay và cuộn chuột' })
    public enablePinchZoom: boolean = true;

    @property({ tooltip: 'Tỉ lệ zoom nhỏ nhất (ví dụ: 0.6 = 60%)' })
    public minZoomScale: number = 0.6;

    @property({ tooltip: 'Tỉ lệ zoom lớn nhất (ví dụ: 2.0 = 200%)' })
    public maxZoomScale: number = 2.0;

    @property({ tooltip: 'Độ nhạy khi zoom' })
    public zoomSensitivity: number = 1.0;

    public isScreenDragging: boolean = false;
    public isPinchZooming: boolean = false;

    // Backward compatibility aliases
    public get screenDragTarget(): Node { return this.screenTarget; }
    public set screenDragTarget(val: Node) { this.screenTarget = val; }
    public get screenZoomTarget(): Node { return this.screenTarget; }
    public set screenZoomTarget(val: Node) { this.screenTarget = val; }

    private currentDraggable: ItemDraggable | null = null;
    private currentSnapItem: ItemSnap | null = null;
    private currentStirring: ItemStirring | null = null;

    private lastPinchDistance: number = 0;
    private lastPinchMidParent: Vec2 = new Vec2();

    private isFirstMove: boolean = true;
    private itemDragPointerUI: Vec2 | null = null;

    protected onLoad() {
        super.onLoad();
        InputManager.instance = this;
        ipm = this;
    }

    public BeginDragItem(draggable: ItemDraggable): void {
        if (this.isInputLocked || !GameManager.Ins?.IsPlaying() || this.isDragging || this.isPinchZooming) return;

        this.currentDraggable = draggable;
        if (draggable.BeginDrag()) {
            this.isDragging = true;
            this.isScreenDragging = false;
            GameManager.Ins.TurnOffTut();
        } else {
            this.currentDraggable = null;
        }
    }

    public BeginStirItem(stirring: ItemStirring, event?: EventTouch): void {
        if (this.isInputLocked || !GameManager.Ins?.IsPlaying() || this.isDragging || this.isPinchZooming) return;

        this.currentStirring = stirring;
        stirring.BeginStir(event);
        if (stirring.IsStirring) {
            this.isDragging = true;
            this.isScreenDragging = false;
            GameManager.Ins.TurnOffTut();
        } else {
            this.currentStirring = null;
        }
    }

    public BeginDragSnapItem(snapItem: ItemSnap, touchWorldPos?: Vec3): void {
        if (this.isInputLocked || !GameManager.Ins?.IsPlaying() || this.isDragging || this.isPinchZooming) return;

        this.currentSnapItem = snapItem;
        this.isDragging = true;
        this.isScreenDragging = false;
        GameManager.Ins?.TurnOffTut();
        snapItem.StartDrag(touchWorldPos);
    }

    public EndInteraction(): void {
        if (this.currentSnapItem) {
            this.currentSnapItem.ReleaseItem();
            this.currentSnapItem = null;
        }

        if (this.currentDraggable) {
            this.currentDraggable.EndDrag();
            this.currentDraggable = null;
        }

        if (this.currentStirring) {
            this.currentStirring.EndStir();
            this.currentStirring = null;
        }

        this.isDragging = false;
        this.isScreenDragging = false;
        this.itemDragPointerUI = null;
    }

    /** Enables or disables all player item, screen-drag and zoom input. */
    public SetInputLocked(isLocked: boolean): void {
        this.isInputLocked = isLocked;
        if (isLocked) this.EndInteraction();
    }

    /** Helper to check if any item is actively being dragged */
    public IsDraggingItem(): boolean {
        return this.isDragging || !!this.currentDraggable || !!this.currentSnapItem || !!this.currentStirring;
    }

    /** Dynamically configure screen drag bounds at runtime */
    public SetScreenDragBounds(min: Vec2, max: Vec2, enableBounds: boolean = true, baseScale: number = 1.0) {
        this.minDragPosition.set(min);
        this.maxDragPosition.set(max);
        this.enableScreenDragBounds = enableBounds;
        if (baseScale > 0) this.baseZoomScale = baseScale;
    }

    /** 
     * Tính toán giới hạn kéo (Min/Max Drag Bounds) tự động co giãn theo tỉ lệ zoom hiện tại.
     * Khi zoom vào (scale > baseZoomScale), phạm vi kéo sẽ mở rộng tương ứng từ tâm bounding box.
     */
    public getDynamicDragBounds(currentScale?: number): { minX: number, maxX: number, minY: number, maxY: number } {
        const scale = currentScale !== undefined ? currentScale : (this.screenTarget?.scale.x ?? 1.0);
        const base = this.baseZoomScale > 0 ? this.baseZoomScale : 1.0;
        const ratio = scale / base;

        const minPosX = Math.min(this.minDragPosition.x, this.maxDragPosition.x);
        const maxPosX = Math.max(this.minDragPosition.x, this.maxDragPosition.x);
        const minPosY = Math.min(this.minDragPosition.y, this.maxDragPosition.y);
        const maxPosY = Math.max(this.minDragPosition.y, this.maxDragPosition.y);

        const centerX = (minPosX + maxPosX) * 0.5;
        const halfW = (maxPosX - minPosX) * 0.5;
        const minX = centerX - halfW * ratio;
        const maxX = centerX + halfW * ratio;

        const centerY = (minPosY + maxPosY) * 0.5;
        const halfH = (maxPosY - minPosY) * 0.5;
        const minY = centerY - halfH * ratio;
        const maxY = centerY + halfH * ratio;

        return { minX, maxX, minY, maxY };
    }

    /** Dynamically configure unified screen target node */
    public SetScreenTarget(target: Node) {
        this.screenTarget = target;
    }

    public SetScreenDragTarget(target: Node, enable: boolean = true) {
        this.screenTarget = target;
        this.enableScreenDrag = enable;
    }

    /** Dynamically configure zoom settings at runtime */
    public SetZoomBounds(minScale: number, maxScale: number) {
        this.minZoomScale = minScale;
        this.maxZoomScale = maxScale;
    }

    public SetZoomTarget(target: Node, enable: boolean = true) {
        this.screenTarget = target;
        this.enablePinchZoom = enable;
    }

    public SetZoomScale(scale: number) {
        if (!this.screenTarget || !this.screenTarget.isValid) return;
        const clamped = math.clamp(scale, this.minZoomScale, this.maxZoomScale);
        this.screenTarget.setScale(new Vec3(clamped, clamped, 1));

        if (this.enableScreenDragBounds) {
            const bounds = this.getDynamicDragBounds(clamped);
            const pos = this.screenTarget.position;
            const clampedX = math.clamp(pos.x, bounds.minX, bounds.maxX);
            const clampedY = math.clamp(pos.y, bounds.minY, bounds.maxY);
            if (clampedX !== pos.x || clampedY !== pos.y) {
                this.screenTarget.setPosition(new Vec3(clampedX, clampedY, pos.z));
            }
        }
    }

    public GetZoomScale(): number {
        return this.screenTarget?.scale.x ?? 1.0;
    }

    /** Updates the pointer used to auto-pan while an ItemDraggable is held. */
    public UpdateItemDragScreenEdgePointer(pointerUI: Vec2): void {
        if (!this.enableScreenDrag || !this.isDragging || !this.currentDraggable) return;
        if (!this.itemDragPointerUI) this.itemDragPointerUI = new Vec2();
        this.itemDragPointerUI.set(pointerUI);
    }

    private UpdateItemDragScreenEdgePan(deltaTime: number): void {
        const target = this.screenTarget;
        const pointer = this.itemDragPointerUI;
        if (!this.enableScreenDrag || !this.isDragging || !this.currentDraggable
            || !target || !target.isValid || !pointer || deltaTime <= 0) return;

        const edgeSize = Math.max(0, this.itemDragScreenEdgeSize);
        const maxSpeed = Math.max(0, this.itemDragScreenEdgeSpeed) * this.screenDragSpeed;
        if (edgeSize <= 0 || maxSpeed <= 0) return;

        const visibleSize = view.getVisibleSize();
        const horizontalStrength = pointer.x < edgeSize
            ? -(1 - pointer.x / edgeSize)
            : pointer.x > visibleSize.width - edgeSize
                ? 1 - (visibleSize.width - pointer.x) / edgeSize
                : 0;
        const verticalStrength = pointer.y < edgeSize
            ? -(1 - pointer.y / edgeSize)
            : pointer.y > visibleSize.height - edgeSize
                ? 1 - (visibleSize.height - pointer.y) / edgeSize
                : 0;

        const currentPos = target.position;
        // Move the gameplay content opposite to the pointer edge direction,
        // matching the natural "drag the screen" interaction.
        let newX = this.lockScreenDragX ? currentPos.x : currentPos.x - horizontalStrength * maxSpeed * deltaTime;
        let newY = this.lockScreenDragY ? currentPos.y : currentPos.y - verticalStrength * maxSpeed * deltaTime;

        if (this.enableScreenDragBounds) {
            const bounds = this.getDynamicDragBounds(target.scale.x);
            newX = math.clamp(newX, bounds.minX, bounds.maxX);
            newY = math.clamp(newY, bounds.minY, bounds.maxY);
        }

        if (newX !== currentPos.x || newY !== currentPos.y) {
            target.setPosition(new Vec3(newX, newY, currentPos.z));
        }
    }

    startPos: Vec2 | null = null;
    dir: Vec2 | null = null;

    bindingStart(event: EventTouch) {}
    bindingMove(event: EventTouch) {}
    bindingEnd(event: EventTouch) {}
    bindingUpdate() {}

    onTouchStart(event: EventTouch) {
        const wasInputLocked = this.isInputLocked;
        if (this.isFirstMove && GameManager.Ins?.IsPlaying()) {
            this.isFirstMove = false;
            Ply_SoundManager.Ins?.PlayBgm();
            ui?.firstMove();
        }
        // The first touch only dismisses the UI intro. Gameplay begins with
        // the following touch after UI.firstMove() unlocks this manager.
        if (wasInputLocked || this.isInputLocked) return;

        const touches = event.getAllTouches();

        // 1. Detect 2-finger touch for Pinch Zoom
        if (this.enablePinchZoom && touches && touches.length >= 2) {
            this.isPinchZooming = true;
            this.isScreenDragging = false;
            this.EndInteraction();
            this.setHandTutScreenNavigation(true);

            const p1 = touches[0].getUILocation();
            const p2 = touches[1].getUILocation();
            this.lastPinchDistance = Vec2.distance(p1, p2);

            const midUI = new Vec2((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5);
            this.lastPinchMidParent.set(this.convertUIToParentSpace(midUI));
            return;
        }

        const isPlaying = !GameManager.Ins || GameManager.Ins.IsPlaying();
        let itemInteracted = false;

        const snapItem = this.getTouchedComponent(event, ItemSnap);
        if (snapItem && snapItem.enabled && snapItem.currentState === ItemState.Waiting && isPlaying) {
            const touchPos = event.getUILocation();
            this.BeginDragSnapItem(snapItem, new Vec3(touchPos.x, touchPos.y, 0));
            itemInteracted = true;
        } else {
            const draggable = this.getTouchedComponent(event, ItemDraggable);
            if (draggable && draggable.enabled && isPlaying) {
                this.BeginDragItem(draggable);
                itemInteracted = true;
            } else {
                const stirring = this.getTouchedComponent(event, ItemStirring);
                if (stirring && stirring.enabled && isPlaying) {
                    this.BeginStirItem(stirring, event);
                    itemInteracted = true;
                } else {
                    const clickable = this.getTouchedComponent(event, ItemClickable);
                    if (clickable && isPlaying && clickable.canClick && clickable.enabled) {
                        clickable.PerformClick();
                        itemInteracted = true;
                    }
                }
            }
        }

        // When NO item is being dragged and screen drag is enabled, start screen drag
        if (!itemInteracted && !this.isDragging && this.enableScreenDrag && this.screenTarget && isPlaying) {
            this.isScreenDragging = true;
            this.setHandTutScreenNavigation(true);
        } else {
            this.isScreenDragging = false;
        }

        this.bindingStart(event);
    }

    onTouchMove(event: EventTouch) {
        if (this.isInputLocked) return;
        const touches = event.getAllTouches();

        // 1. Handle 2-Finger Pinch Zoom & Two-Finger Pan
        if (this.enablePinchZoom && touches && touches.length >= 2) {
            this.handlePinchZoomMove(touches);
            return;
        }

        // 2. Handle Single-Finger Item Drag or Screen Drag
        if (this.IsDraggingItem()) {
            this.currentSnapItem?.HandleTouchMove(event);
            this.currentDraggable?.HandleTouchMove(event);
            this.currentStirring?.Stir(event);
        } else if (this.isScreenDragging && this.enableScreenDrag && this.screenTarget) {
            this.handleScreenDragMove(event);
        }

        this.bindingMove(event);
    }

    private convertUIToParentSpace(uiPoint: Vec2): Vec2 {
        if (!this.screenTarget || !this.screenTarget.isValid) return uiPoint;

        const parent = this.screenTarget.parent;
        const parentTransform = parent?.getComponent(UITransform);
        if (parentTransform) {
            const local = parentTransform.convertToNodeSpaceAR(new Vec3(uiPoint.x, uiPoint.y, 0));
            return new Vec2(local.x, local.y);
        }
        return uiPoint;
    }

    private handlePinchZoomMove(touches: any[]) {
        const target = this.screenTarget;
        if (!target || !target.isValid) return;

        const p1 = touches[0].getUILocation();
        const p2 = touches[1].getUILocation();
        const currentDistance = Vec2.distance(p1, p2);
        const currentMidUI = new Vec2((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5);
        const currMidParent = this.convertUIToParentSpace(currentMidUI);

        if (this.lastPinchDistance > 0 && Math.abs(currentDistance - this.lastPinchDistance) > 0.1) {
            const rawRatio = currentDistance / this.lastPinchDistance;
            const currentScale = target.scale.x;
            const factor = Math.pow(rawRatio, this.zoomSensitivity);
            let targetScale = currentScale * factor;
            targetScale = math.clamp(targetScale, this.minZoomScale, this.maxZoomScale);

            const r = targetScale / currentScale;
            const pos = target.position;

            // Zoom centered precisely on the pinch focal point:
            // Pos_new = F_curr - r * (F_prev - Pos_old)
            let newX = currMidParent.x - r * (this.lastPinchMidParent.x - pos.x);
            let newY = currMidParent.y - r * (this.lastPinchMidParent.y - pos.y);

            if (this.lockScreenDragX) newX = pos.x;
            if (this.lockScreenDragY) newY = pos.y;

            if (this.enableScreenDragBounds) {
                const bounds = this.getDynamicDragBounds(targetScale);
                newX = math.clamp(newX, bounds.minX, bounds.maxX);
                newY = math.clamp(newY, bounds.minY, bounds.maxY);
            }

            target.setPosition(new Vec3(newX, newY, pos.z));
            target.setScale(new Vec3(targetScale, targetScale, 1));
        } else if (this.lastPinchDistance > 0) {
            // Pure two-finger pan when pinch distance is unchanged
            const pos = target.position;
            let newX = pos.x + (currMidParent.x - this.lastPinchMidParent.x);
            let newY = pos.y + (currMidParent.y - this.lastPinchMidParent.y);

            if (this.lockScreenDragX) newX = pos.x;
            if (this.lockScreenDragY) newY = pos.y;

            if (this.enableScreenDragBounds) {
                const bounds = this.getDynamicDragBounds(target.scale.x);
                newX = math.clamp(newX, bounds.minX, bounds.maxX);
                newY = math.clamp(newY, bounds.minY, bounds.maxY);
            }

            target.setPosition(new Vec3(newX, newY, pos.z));
        }

        this.lastPinchDistance = currentDistance;
        this.lastPinchMidParent.set(currMidParent);
    }

    private handleScreenDragMove(event: EventTouch) {
        const target = this.screenTarget;
        if (!target || !target.isValid) return;

        const uiDelta = event.getUIDelta();
        const dx = this.lockScreenDragX ? 0 : uiDelta.x * this.screenDragSpeed;
        const dy = this.lockScreenDragY ? 0 : uiDelta.y * this.screenDragSpeed;

        const currentPos = target.position;
        let newX = currentPos.x + dx;
        let newY = currentPos.y + dy;

        if (this.enableScreenDragBounds) {
            const bounds = this.getDynamicDragBounds(target.scale.x);
            newX = math.clamp(newX, bounds.minX, bounds.maxX);
            newY = math.clamp(newY, bounds.minY, bounds.maxY);
        }

        target.setPosition(new Vec3(newX, newY, currentPos.z));
    }

    onTouchEnd(event: EventTouch) {
        if (this.isInputLocked) return;
        const touches = event.getAllTouches();
        if (!touches || touches.length < 2) {
            this.isPinchZooming = false;
            this.lastPinchDistance = 0;
        }

        this.currentDraggable?.CompleteTouchDrag();
        this.EndInteraction();
        this.isScreenDragging = false;
        this.setHandTutScreenNavigation(false);
        this.bindingEnd(event);
    }

    /** Screen navigation hides the hint, then lets its normal idle delay start again. */
    private setHandTutScreenNavigation(isActive: boolean): void {
        HandTutManager.Ins?.SetScreenNavigationActive(isActive);
    }

    private resetHandTutDelayForScreenNavigation(): void {
        HandTutManager.Ins?.ResetHandTutDelay();
    }

    private onMouseWheel(event: EventMouse) {
        if (this.isInputLocked || !this.enablePinchZoom) return;

        const target = this.screenTarget;
        if (!target || !target.isValid) return;

        const scrollY = event.getScrollY();
        if (scrollY === 0) return;

        this.resetHandTutDelayForScreenNavigation();

        const mouseUI = event.getUILocation();
        const fParent = this.convertUIToParentSpace(mouseUI);

        const currentScale = target.scale.x;
        const zoomFactor = scrollY > 0 ? (1.0 + 0.1 * this.zoomSensitivity) : (1.0 - 0.1 * this.zoomSensitivity);
        let targetScale = currentScale * zoomFactor;
        targetScale = math.clamp(targetScale, this.minZoomScale, this.maxZoomScale);

        const r = targetScale / currentScale;
        const pos = target.position;

        // Zoom centered precisely on cursor position:
        let newX = fParent.x - r * (fParent.x - pos.x);
        let newY = fParent.y - r * (fParent.y - pos.y);

        if (this.lockScreenDragX) newX = pos.x;
        if (this.lockScreenDragY) newY = pos.y;

        if (this.enableScreenDragBounds) {
            const bounds = this.getDynamicDragBounds(targetScale);
            newX = math.clamp(newX, bounds.minX, bounds.maxX);
            newY = math.clamp(newY, bounds.minY, bounds.maxY);
        }

        target.setPosition(new Vec3(newX, newY, pos.z));
        target.setScale(new Vec3(targetScale, targetScale, 1));
    }

    binding() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    offBinding() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    protected onDestroy() {
        this.offBinding();
        if (InputManager.instance === this) InputManager.instance = null;
        if (ipm === this) ipm = null;
        super.onDestroy();
    }

    start() {
        this.binding();
    }

    update(deltaTime: number) {
        this.UpdateItemDragScreenEdgePan(deltaTime);
        this.bindingUpdate(); 
    }

    private getTouchedComponent<T>(event: EventTouch, componentType: new (...args: any[]) => T): T | null {
        let target = event.target as Node | null;
        while (target) {
            const component = target.getComponent(componentType as any) as T | null;
            if (component) return component;
            target = target.parent;
        }

        const scene = this.node.scene;
        if (!scene) return null;

        const touchPosition = event.getUILocation();
        const worldTouchPosition = new Vec3(touchPosition.x, touchPosition.y, 0);
        const components = scene.getComponentsInChildren(componentType as any) as T[];
        for (let i = components.length - 1; i >= 0; i--) {
            const component = components[i] as any;
            const node = component.node as Node | null;
            const transform = node?.getComponent(UITransform);
            if (!node?.activeInHierarchy || !transform) continue;

            const localPoint = transform.convertToNodeSpaceAR(worldTouchPosition);
            const left = -transform.anchorX * transform.width;
            const bottom = -transform.anchorY * transform.height;
            if (localPoint.x >= left && localPoint.x <= left + transform.width
                && localPoint.y >= bottom && localPoint.y <= bottom + transform.height) {
                return component as T;
            }
        }
        return null;
    }
}
