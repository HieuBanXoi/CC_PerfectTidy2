import { _decorator, Component, Node, Vec3, Enum, Tween, tween, Sprite, SpriteFrame, UITransform, EventTouch } from 'cc';
import { ItemSpawnManager } from './ItemSpawnManager';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { Ply_Event } from '../../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

export enum BoxAnimationType {
    Tween = 0
}
Enum(BoxAnimationType);

@ccclass('ItemBox')
export class ItemBox extends Ply_EventHandlerComponent {
    @property
    public useBox: boolean = true;

    @property({ type: Enum(BoxAnimationType) })
    public animationType: BoxAnimationType = BoxAnimationType.Tween;

    @property({ type: ItemSpawnManager })
    public spawnManager: ItemSpawnManager = null!;

    @property
    public spawnCountPerClick: number = 0;

    @property
    public flyDuration: number = 0.55;

    @property
    public jumpHeight: number = 120;

    @property({ type: Node })
    public spawnPoint: Node | null = null;

    @property
    public canClick: boolean = true;

    @property
    public maxClicks: number = 1;

    @property
    public hideBoxWhenEmpty: boolean = true;

    @property({ type: SpriteFrame })
    public openBoxSprite: SpriteFrame | null = null;

    @property({ type: Enum(FxType) })
    public clickFxType: FxType = FxType.Click;

    @property({ type: Ply_Event })
    public onBoxClick: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event })
    public onAllItemsSpawned: Ply_Event = new Ply_Event();

    private currentClicks: number = 0;
    private isSpawning: boolean = false;
    private originalScale: Vec3 = new Vec3();
    private originalPos: Vec3 = new Vec3();
    private touchStartPos: Vec3 = new Vec3();

    protected onLoad(): void {
        this.originalScale.set(this.node.scale);
        this.originalPos.set(this.node.position);

        let ut = this.getComponent(UITransform);
        if (!ut) {
            ut = this.addComponent(UITransform);
            ut.setContentSize(100, 100);
        }
    }

    protected start(): void {
        if (!this.spawnManager) {
            this.spawnManager = ItemSpawnManager.Ins;
        }
        this.initBoxAnimation();
    }

    private initBoxAnimation(): void {
        if (!this.useBox) return;

        const sx = this.originalScale.x;
        const sy = this.originalScale.y;
        const sz = this.originalScale.z;
        const px = this.originalPos.x;
        const py = this.originalPos.y;
        const pz = this.originalPos.z;

        this.node.setScale(Vec3.ZERO);
        this.node.setPosition(new Vec3(px, py - 35, pz));

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.35, {
                scale: new Vec3(sx * 1.18, sy * 1.25, sz),
                position: new Vec3(px, py + 28, pz)
            }, { easing: 'backOut' })
            .to(0.16, {
                scale: new Vec3(sx * 1.06, sy * 0.92, sz),
                position: new Vec3(px, py - 6, pz)
            }, { easing: 'sineInOut' })
            .to(0.18, {
                scale: this.originalScale,
                position: this.originalPos
            }, { easing: 'sineOut' })
            .call(() => (GameManager.Ins as any)?.TriggerTutorial?.())
            .start();
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        Tween.stopAllByTarget(this.node);
    }

    private onTouchStart(event: EventTouch): void {
        const touchLoc = event.getUILocation();
        this.touchStartPos.set(touchLoc.x, touchLoc.y, 0);
    }

    private onTouchEnd(event: EventTouch): void {
        if (!this.canClick || this.isSpawning) return;

        const touchLoc = event.getUILocation();
        const dist = Vec3.distance(this.touchStartPos, new Vec3(touchLoc.x, touchLoc.y, 0));
        if (dist > 25) return;

        this.OpenBox();
    }

    public OpenBox(): void {
        if (!this.canClick || this.isSpawning) return;

        const manager = this.spawnManager || ItemSpawnManager.Ins;
        if (!manager || !manager.HasItems()) {
            this.TryPlayEndAnimation();
            return;
        }

        this.currentClicks++;
        this.isSpawning = true;

        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        (GameManager.Ins as any)?.ResetInactivityTimer?.(null);
        this.onBoxClick.invoke();

        const sx = this.originalScale.x;
        const sy = this.originalScale.y;
        const sz = this.originalScale.z;
        const px = this.originalPos.x;
        const py = this.originalPos.y;
        const pz = this.originalPos.z;

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.14, {
                scale: new Vec3(sx * 1.2, sy * 0.78, sz),
                position: new Vec3(px, py - 16, pz)
            }, { easing: 'quadOut' })
            .to(0.16, {
                scale: new Vec3(sx * 0.86, sy * 1.28, sz),
                position: new Vec3(px, py + 22, pz)
            }, { easing: 'backOut' })
            .call(() => {
                if (this.openBoxSprite) {
                    const sprite = this.getComponent(Sprite) || this.getComponentInChildren(Sprite);
                    if (sprite) sprite.spriteFrame = this.openBoxSprite;
                }
                this.spawnBatchItems(manager);
            })
            .to(0.22, {
                scale: this.originalScale,
                position: this.originalPos
            }, { easing: 'backOut' })
            .start();
    }

    private spawnBatchItems(manager: ItemSpawnManager): void {
        let countToSpawn = this.spawnCountPerClick;
        if (countToSpawn <= 0) {
            countToSpawn = manager.initialSpawnCount || manager.GetRemainingItemCount();
        }
        countToSpawn = Math.min(countToSpawn, manager.GetRemainingItemCount());

        const spawnWorldPos = this.spawnPoint ? this.spawnPoint.worldPosition : this.node.worldPosition;
        let landedCount = 0;

        for (let i = 0; i < countToSpawn; i++) {
            manager.SpawnNextItemFromSource(
                spawnWorldPos,
                i,
                countToSpawn,
                this.flyDuration,
                this.jumpHeight,
                () => {
                    landedCount++;
                    if (landedCount >= countToSpawn) this.onAllItemsLanded(manager);
                }
            );
        }
    }

    private onAllItemsLanded(manager: ItemSpawnManager): void {
        this.isSpawning = false;
        this.onAllItemsSpawned.invoke();

        if (manager) manager.TriggerImmediateHandTut();

        if (!manager.HasItems() || (this.maxClicks > 0 && this.currentClicks >= this.maxClicks)) {
            this.canClick = false;
            this.TryPlayEndAnimation();
        }
    }

    public TryPlayEndAnimation(): void {
        if (!this.useBox) return;

        const manager = this.spawnManager || ItemSpawnManager.Ins;
        if (manager && manager.HasItems() && (this.maxClicks <= 0 || this.currentClicks < this.maxClicks)) return;

        if (this.hideBoxWhenEmpty) {
            Tween.stopAllByTarget(this.node);
            tween(this.node)
                .to(0.3, { scale: Vec3.ZERO }, { easing: 'backIn' })
                .call(() => { this.node.active = false; })
                .start();
        }
    }

    public CanClick(canClick: boolean): void {
        this.canClick = canClick;
    }

    public EnableClick(): void {
        this.canClick = true;
    }

    public DisableClick(): void {
        this.canClick = false;
    }
}
