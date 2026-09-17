import { _decorator, Component, Node, Vec3, Enum, Tween, tween, Sprite, SpriteFrame, UITransform, EventTouch, sp } from 'cc';
import { ItemSpawnManager } from './ItemSpawnManager';
import { BoxGraphicController } from './BoxGraphicController';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { Ply_Event } from '../../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

export enum BoxAnimationType {
    Tween = 0,    // Dùng anim nhún nảy Tween & đổi Sprite cũ
    Spine = 1,    // Dùng hệ thống Spine animation (0-Drop, 1-ready-Loop, 2-OPEN, 3-OPEN-click, 4-End)
}
Enum(BoxAnimationType);

@ccclass('ItemBox')
export class ItemBox extends Ply_EventHandlerComponent {

    @property({
        tooltip: 'Sử dụng logic mở hộp để spawn item'
    })
    public useBox: boolean = true;

    @property({
        type: Enum(BoxAnimationType),
        tooltip: 'Tween: Dùng anim nhún nảy Tween & SpriteFrame cũ; Spine: Dùng bộ Spine animation'
    })
    public animationType: BoxAnimationType = BoxAnimationType.Spine;

    @property({
        type: BoxGraphicController,
        tooltip: 'Controller điều khiển animation Spine của Box (dùng khi animationType = Spine)'
    })
    public graphicController: BoxGraphicController | null = null;

    @property({
        type: sp.Skeleton,
        tooltip: 'Component Spine Skeleton của Box (dùng khi animationType = Spine)'
    })
    public skeletonAnimation: sp.Skeleton | null = null;

    @property({
        type: ItemSpawnManager,
        tooltip: 'Tham chiếu tới ItemSpawnManager (nếu để trống sẽ tự động lấy ItemSpawnManager.Ins)'
    })
    public spawnManager: ItemSpawnManager = null!;

    @property({
        tooltip: 'Số lượng item bay ra đồng thời mỗi lần click (0 = lấy theo initialSpawnCount của ItemSpawnManager)'
    })
    public spawnCountPerClick: number = 0;

    @property({
        tooltip: 'Thời gian mỗi item bay từ hộp ra vị trí đích (giây)'
    })
    public flyDuration: number = 0.55;

    @property({
        tooltip: 'Độ cao vồng lên dạng parabol khi item bay ra khỏi hộp'
    })
    public jumpHeight: number = 120;

    @property({
        type: Node,
        tooltip: 'Vị trí xuất phát của item (miệng hộp). Nếu để trống sẽ lấy chính tâm của Box'
    })
    public spawnPoint: Node | null = null;

    @property({
        tooltip: 'Cho phép người chơi click vào hộp'
    })
    public canClick: boolean = true;

    @property({
        tooltip: 'Số lần click tối đa (ví dụ 1 lần là mở hết, hoặc nhiều lần)'
    })
    public maxClicks: number = 1;

    @property({
        tooltip: 'Tự động ẩn Box sau khi đã kết thúc animation End / mở hết item'
    })
    public hideBoxWhenEmpty: boolean = true;

    @property({
        type: SpriteFrame,
        tooltip: 'SpriteFrame hộp mở (dùng khi animationType = Tween hoặc khi không có Spine)'
    })
    public openBoxSprite: SpriteFrame | null = null;

    @property({
        type: Enum(FxType),
        tooltip: 'Âm thanh khi click mở hộp'
    })
    public clickFxType: FxType = FxType.Click;

    @property({
        type: Ply_Event,
        tooltip: 'Sự kiện khi click vào hộp'
    })
    public onBoxClick: Ply_Event = new Ply_Event();

    @property({
        type: Ply_Event,
        tooltip: 'Sự kiện khi tất cả các item trong đợt đã bay ra và tiếp đất hoàn tất'
    })
    public onAllItemsSpawned: Ply_Event = new Ply_Event();

    private currentClicks: number = 0;
    private isSpawning: boolean = false;
    private isOpened: boolean = false;
    private isPlayingBoxAnimation: boolean = false;
    private originalScale: Vec3 = new Vec3();
    private originalPos: Vec3 = new Vec3();
    private touchStartPos: Vec3 = new Vec3();

    protected onLoad(): void {
        this.originalScale.set(this.node.scale);
        this.originalPos.set(this.node.position);

        // Đảm bảo Node Box có UITransform để bắt được sự kiện touch
        let ut = this.getComponent(UITransform);
        if (!ut) {
            ut = this.addComponent(UITransform);
            ut.setContentSize(100, 100);
        }

        if (!this.graphicController) {
            this.graphicController = this.getComponent(BoxGraphicController) || this.getComponentInChildren(BoxGraphicController);
        }

        if (!this.skeletonAnimation) {
            this.skeletonAnimation = this.getComponent(sp.Skeleton) || this.getComponentInChildren(sp.Skeleton);
        }
    }

    protected start(): void {
        if (!this.spawnManager) {
            this.spawnManager = ItemSpawnManager.Ins;
        }

        this.initBoxAnimation();
    }

    /**
     * Khởi chạy animation vào màn chơi
     */
    private initBoxAnimation(): void {
        if (!this.useBox) {
            return;
        }

        if (this.animationType === BoxAnimationType.Spine && this.hasSpineAnim()) {
            // Spine: "0-Drop" -> "1-ready-Loop"
            this.playAnim("0-Drop", false, () => {
                this.playAnim("1-ready-Loop", true);
                (GameManager.Ins as any)?.TriggerTutorial?.();
            });
        } else {
            // Tween: Zoom to từ 0, bật nảy lên cao rồi đàn hồi ổn định về vị trí gốc
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
                // Giai đoạn 1: Zoom to vượt ngưỡng và bật nảy vọt lên trên
                .to(0.35, {
                    scale: new Vec3(sx * 1.18, sy * 1.25, sz),
                    position: new Vec3(px, py + 28, pz)
                }, { easing: 'backOut' })
                // Giai đoạn 2: Rơi nhẹ xuống và nén nhẹ
                .to(0.16, {
                    scale: new Vec3(sx * 1.06, sy * 0.92, sz),
                    position: new Vec3(px, py - 6, pz)
                }, { easing: 'sineInOut' })
                // Giai đoạn 3: Ổn định về chuẩn
                .to(0.18, {
                    scale: this.originalScale,
                    position: this.originalPos
                }, { easing: 'sineOut' })
                .call(() => {
                    (GameManager.Ins as any)?.TriggerTutorial?.();
                })
                .start();
        }
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
        if (!this.canClick || this.isSpawning || this.isPlayingBoxAnimation) return;

        // Tránh nhầm lẫn giữa vuốt màn hình và click
        const touchLoc = event.getUILocation();
        const dist = Vec3.distance(this.touchStartPos, new Vec3(touchLoc.x, touchLoc.y, 0));
        if (dist > 25) return;

        this.OpenBox();
    }

    /**
     * Mở hộp và spawn item theo loại Animation đã chọn (Tween hoặc Spine)
     */
    public OpenBox(): void {
        if (!this.canClick || this.isSpawning || this.isPlayingBoxAnimation) return;

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

        if (this.animationType === BoxAnimationType.Spine && this.hasSpineAnim()) {
            this.handleSpineBoxClick(manager);
        } else {
            this.handleTweenBoxClick(manager);
        }
    }

    /**
     * Xử lý Anim Box cũ: Nhún nhẹ xuống -> Bung mạnh lên (Spawn item) -> Đàn hồi về ban đầu
     */
    private handleTweenBoxClick(manager: ItemSpawnManager): void {
        const sx = this.originalScale.x;
        const sy = this.originalScale.y;
        const sz = this.originalScale.z;
        const px = this.originalPos.x;
        const py = this.originalPos.y;
        const pz = this.originalPos.z;

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            // Giai đoạn 1: Nhún nhẹ xuống (Squash & Dip)
            .to(0.14, {
                scale: new Vec3(sx * 1.2, sy * 0.78, sz),
                position: new Vec3(px, py - 16, pz)
            }, { easing: 'quadOut' })
            // Giai đoạn 2: Bung mạnh lên (Stretch & Pop up)
            .to(0.16, {
                scale: new Vec3(sx * 0.86, sy * 1.28, sz),
                position: new Vec3(px, py + 22, pz)
            }, { easing: 'backOut' })
            // NGAY KHI BUNG LÊN: Đổi sprite (nếu có) và phóng item ra
            .call(() => {
                if (this.openBoxSprite) {
                    const sprite = this.getComponent(Sprite) || this.getComponentInChildren(Sprite);
                    if (sprite) {
                        sprite.spriteFrame = this.openBoxSprite;
                    }
                }
                this.spawnBatchItems(manager);
            })
            // Giai đoạn 3: Đàn hồi về vị trí và kích thước bình thường
            .to(0.22, {
                scale: this.originalScale,
                position: this.originalPos
            }, { easing: 'backOut' })
            .start();
    }

    /**
     * Xử lý Anim Box Spine: "2-OPEN" / "3-OPEN-click" -> "3-OPEN-loop-break"
     */
    private handleSpineBoxClick(manager: ItemSpawnManager): void {
        // Lần đầu mở hộp: "2-OPEN" -> spawn item -> "3-OPEN-click" -> "3-OPEN-loop-break"
        if (!this.isOpened) {
            this.isOpened = true;
            this.isPlayingBoxAnimation = true;

            this.playAnim("2-OPEN", false, () => {
                // Spawn item ngay khi hộp bung mở hoàn tất
                this.spawnBatchItems(manager);

                this.playAnim("3-OPEN-click", false, () => {
                    this.playAnim("3-OPEN-loop-break", true);
                    this.isPlayingBoxAnimation = false;
                });
            });
            return;
        }

        // Các lần click tiếp theo khi hộp đã mở sẵn
        if (!manager.HasItems()) {
            this.TryPlayEndAnimation();
            return;
        }

        this.isPlayingBoxAnimation = true;
        this.playAnim("3-OPEN-click", false, () => {
            if (!manager.HasItems()) {
                this.TryPlayEndAnimation();
            } else {
                this.playAnim("3-OPEN-loop", true);
                this.isPlayingBoxAnimation = false;
            }
        });

        this.spawnBatchItems(manager);
    }

    private spawnBatchItems(manager: ItemSpawnManager): void {
        let countToSpawn = this.spawnCountPerClick;
        if (countToSpawn <= 0) {
            countToSpawn = manager.initialSpawnCount || manager.GetRemainingItemCount();
        }
        countToSpawn = Math.min(countToSpawn, manager.GetRemainingItemCount());

        const spawnWorldPos = this.spawnPoint ? this.spawnPoint.worldPosition : this.node.worldPosition;
        let landedCount = 0;

        // Phóng đồng thời toàn bộ item trong đợt ra các vị trí ngẫu nhiên
        for (let i = 0; i < countToSpawn; i++) {
            manager.SpawnNextItemFromSource(
                spawnWorldPos,
                i,
                countToSpawn,
                this.flyDuration,
                this.jumpHeight,
                () => {
                    landedCount++;
                    if (landedCount >= countToSpawn) {
                        this.onAllItemsLanded(manager);
                    }
                }
            );
        }
    }

    private onAllItemsLanded(manager: ItemSpawnManager): void {
        this.isSpawning = false;
        this.onAllItemsSpawned.invoke();

        // Kích hoạt bàn tay hướng dẫn (HandTut) đầu tiên ngay lập tức (delay = 0)
        if (manager) {
            manager.TriggerImmediateHandTut();
        }

        // Kiểm tra xem đã hết lượt click hoặc hết item chưa
        if (!manager.HasItems() || (this.maxClicks > 0 && this.currentClicks >= this.maxClicks)) {
            this.canClick = false;
            this.TryPlayEndAnimation();
        }
    }

    /**
     * Chạy animation kết thúc: "4-End" (Spine) hoặc Tween zoom về 0 (Tween)
     */
    public TryPlayEndAnimation(): void {
        if (!this.useBox) return;

        const manager = this.spawnManager || ItemSpawnManager.Ins;
        if (manager && manager.HasItems() && (this.maxClicks <= 0 || this.currentClicks < this.maxClicks)) {
            return;
        }

        if (this.animationType === BoxAnimationType.Spine && this.hasSpineAnim()) {
            this.isPlayingBoxAnimation = true;
            this.playAnim("4-End", false, () => {
                this.isPlayingBoxAnimation = false;
                if (this.hideBoxWhenEmpty) {
                    this.node.active = false;
                }
            });
        } else {
            this.isPlayingBoxAnimation = false;
            if (this.hideBoxWhenEmpty) {
                Tween.stopAllByTarget(this.node);
                tween(this.node)
                    .to(0.3, { scale: Vec3.ZERO }, { easing: 'backIn' })
                    .call(() => {
                        this.node.active = false;
                    })
                    .start();
            }
        }
    }

    private hasSpineAnim(): boolean {
        return !!(this.graphicController || this.skeletonAnimation);
    }

    private playAnim(animName: string, loop: boolean = false, onComplete?: () => void): void {
        if (this.graphicController) {
            this.graphicController.ChangeAnim(animName, loop, onComplete);
            return;
        }

        if (this.skeletonAnimation) {
            try {
                const trackEntry = this.skeletonAnimation.setAnimation(0, animName, loop);
                if (!loop && onComplete) {
                    const duration = (trackEntry && trackEntry.animation) ? trackEntry.animation.duration : 0.5;
                    this.scheduleOnce(() => {
                        onComplete();
                    }, duration);
                }
            } catch (e) {
                console.error(`❌ [ItemBox] Lỗi play spine anim '${animName}':`, e);
                onComplete?.();
            }
            return;
        }

        onComplete?.();
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
