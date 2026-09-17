import { _decorator, Node, Vec3, Enum, UITransform, EventTouch, sp } from 'cc';
import { ItemSpawnManager } from './ItemSpawnManager';
import { BoxGraphicController } from './BoxGraphicController';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { Ply_Event } from '../../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

/**
 * Hộp chứa item: chỉ quản lý animation Spine của hộp và đăng ký điểm xuất phát (spawnPoint)
 * cho ItemSpawnManager. Toàn bộ logic spawn item nằm ở ItemSpawnManager.
 *
 * Luồng Spine: "0-Drop" -> "1-ready-Loop" -> (click) "2-OPEN" -> "3-OPEN-click" -> "3-OPEN-loop-break"
 *              -> (click tiếp) "3-OPEN-click" -> "3-OPEN-loop" -> (hết item / hết lượt) "4-End"
 */
@ccclass('ItemBox')
export class ItemBox extends Ply_EventHandlerComponent {

    @property({
        tooltip: 'Bật hộp: item sẽ bay ra từ spawnPoint khi click. Tắt thì hộp không đăng ký với ItemSpawnManager'
    })
    public useBox: boolean = true;

    @property({
        tooltip: 'Tự hiện hộp ngay khi start. Tắt = hộp ẩn lúc đầu, chỉ xuất hiện khi gọi BoxAppear()'
    })
    public appearOnStart: boolean = false;

    @property({
        type: BoxGraphicController,
        tooltip: 'Controller điều khiển animation Spine của Box (để trống sẽ tự tìm)'
    })
    public graphicController: BoxGraphicController | null = null;

    @property({
        type: sp.Skeleton,
        tooltip: 'Component Spine Skeleton của Box (để trống sẽ tự tìm)'
    })
    public skeletonAnimation: sp.Skeleton | null = null;

    @property({
        type: ItemSpawnManager,
        tooltip: 'Tham chiếu tới ItemSpawnManager (nếu để trống sẽ tự động lấy ItemSpawnManager.Ins)'
    })
    public spawnManager: ItemSpawnManager = null!;

    @property({
        type: Node,
        tooltip: 'Vị trí xuất phát của item (miệng hộp). Nếu để trống sẽ lấy chính tâm của Box'
    })
    public spawnPoint: Node | null = null;

    @property({
        tooltip: 'Số item bay ra mỗi lần click (0 = dùng initialSpawnCount của ItemSpawnManager)'
    })
    public spawnCountPerClick: number = 0;

    @property({
        tooltip: 'Cho phép người chơi click vào hộp'
    })
    public canClick: boolean = true;

    @property({
        tooltip: 'Số lần click tối đa (0 = không giới hạn, click tới khi hết item)'
    })
    public maxClicks: number = 0;

    @property({
        tooltip: 'Cho phép click liên tục: mỗi click bung thêm 1 đợt item ngay cả khi đợt trước đang bay / anim click chưa xong'
    })
    public allowRapidClick: boolean = true;

    @property({
        tooltip: 'Tự động ẩn Box sau khi chạy xong animation End'
    })
    public hideBoxWhenEmpty: boolean = true;

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
    private pendingBatches: number = 0;      // số đợt item đang bay chưa tiếp đất
    private isOpened: boolean = false;
    private isOpening: boolean = false;      // đang chạy "2-OPEN" lần đầu
    private isPlayingBoxAnimation: boolean = false;
    private isEnded: boolean = false;
    private hasAppeared: boolean = false;
    private animToken: number = 0;           // chỉ callback của anim mới nhất được xử lý (chống spam click)
    private touchStartPos: Vec3 = new Vec3();

    protected onLoad(): void {
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

        if (!this.useBox) {
            return;
        }

        // Đăng ký điểm xuất phát để mọi item spawn từ ItemSpawnManager đều bay ra từ hộp
        // (khi hộp còn ẩn, HasSpawnSource() tự trả false nên item sẽ hiện tại chỗ)
        const manager = this.getManager();
        if (manager) {
            manager.SetSpawnSource(this.spawnPoint || this.node);
            if (manager.autoSpawnOnStart) {
                console.warn('⚠️ [ItemBox] ItemSpawnManager.autoSpawnOnStart đang bật — item sẽ tự bay ra lúc start thay vì chờ click hộp.');
            }
        }

        if (this.appearOnStart) {
            this.BoxAppear();
        } else {
            // Ẩn hộp, chờ gọi BoxAppear()
            this.node.active = false;
        }
    }

    /**
     * Hiện hộp: bật node và chạy anim "0-Drop" -> "1-ready-Loop". Gọi từ code / Ply_Event khi muốn hộp xuất hiện.
     */
    public BoxAppear(): void {
        if (!this.useBox || this.hasAppeared || this.isEnded) return;
        this.hasAppeared = true;

        this.node.active = true;

        this.playAnim("0-Drop", false, () => {
            this.playAnim("1-ready-Loop", true);
            (GameManager.Ins as any)?.TriggerTutorial?.();
        });
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    protected onDestroy(): void {
        // Huỷ đăng ký nguồn spawn nếu vẫn đang trỏ về hộp này
        const manager = this.getManager();
        const source = this.spawnPoint || this.node;
        if (manager && manager.spawnSourceNode === source) {
            manager.SetSpawnSource(null);
        }
    }

    private getManager(): ItemSpawnManager | null {
        return this.spawnManager || ItemSpawnManager.Ins || null;
    }

    private onTouchStart(event: EventTouch): void {
        const touchLoc = event.getUILocation();
        this.touchStartPos.set(touchLoc.x, touchLoc.y, 0);
    }

    private onTouchEnd(event: EventTouch): void {
        // Tránh nhầm lẫn giữa vuốt màn hình và click
        const touchLoc = event.getUILocation();
        const dist = Vec3.distance(this.touchStartPos, new Vec3(touchLoc.x, touchLoc.y, 0));
        if (dist > 25) return;

        this.OpenBox();
    }

    /**
     * Click hộp: chạy anim Spine và yêu cầu ItemSpawnManager spawn một đợt item bay ra từ spawnPoint
     */
    public OpenBox(): void {
        if (!this.useBox || !this.hasAppeared || !this.canClick || this.isEnded || this.isOpening) return;
        if (this.maxClicks > 0 && this.currentClicks >= this.maxClicks) return;
        if (!this.allowRapidClick && (this.isPlayingBoxAnimation || this.pendingBatches > 0)) return;

        const manager = this.getManager();
        if (!manager || !manager.HasItems()) {
            this.TryPlayEndAnimation();
            return;
        }

        this.currentClicks++;

        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        (GameManager.Ins as any)?.ResetInactivityTimer?.(null);
        this.onBoxClick.invoke();

        // Lần đầu mở hộp: "2-OPEN" -> spawn -> "3-OPEN-click" -> "3-OPEN-loop-break"
        if (!this.isOpened) {
            this.isOpened = true;
            this.isOpening = true;
            this.isPlayingBoxAnimation = true;

            this.playAnim("2-OPEN", false, () => {
                this.isOpening = false;
                this.spawnBatch(manager);
                this.playAnim("3-OPEN-click", false, () => this.onClickAnimFinished("3-OPEN-loop-break"));
            });
            return;
        }

        // Các lần click tiếp theo: "3-OPEN-click" + spawn đồng thời -> "3-OPEN-loop"
        this.isPlayingBoxAnimation = true;
        this.playAnim("3-OPEN-click", false, () => this.onClickAnimFinished("3-OPEN-loop"));

        this.spawnBatch(manager);
    }

    /**
     * Khi anim click chạy xong: nếu đã hết item / hết lượt thì End, ngược lại về loop
     */
    private onClickAnimFinished(loopAnim: string): void {
        this.isPlayingBoxAnimation = false;

        if (this.shouldEnd()) {
            this.TryPlayEndAnimation();
        } else {
            this.playAnim(loopAnim, true);
        }
    }

    private shouldEnd(): boolean {
        const manager = this.getManager();
        const outOfItems = !manager || !manager.HasItems();
        const outOfClicks = this.maxClicks > 0 && this.currentClicks >= this.maxClicks;
        return outOfItems || outOfClicks;
    }

    private spawnBatch(manager: ItemSpawnManager): void {
        this.pendingBatches++;
        manager.SpawnBatch(this.spawnCountPerClick, () => this.onAllItemsLanded(manager));
    }

    private onAllItemsLanded(manager: ItemSpawnManager): void {
        this.pendingBatches = Math.max(0, this.pendingBatches - 1);
        if (this.pendingBatches > 0) return;   // còn đợt khác đang bay (spam click)

        this.onAllItemsSpawned.invoke();

        // Hết item hoặc hết lượt click -> khoá hộp và chạy anim End
        // (nếu anim click vẫn đang chạy thì onClickAnimFinished sẽ gọi End sau)
        if (this.shouldEnd()) {
            this.canClick = false;
            this.TryPlayEndAnimation();
        }
    }

    /**
     * Chạy animation kết thúc "4-End" rồi ẩn hộp (nếu hideBoxWhenEmpty)
     */
    public TryPlayEndAnimation(): void {
        if (!this.useBox || this.isEnded || !this.shouldEnd()) return;

        // Đang chạy anim click hoặc còn item đang bay thì chờ xong rồi mới End
        // (onClickAnimFinished / onAllItemsLanded sẽ gọi lại)
        if (this.isPlayingBoxAnimation || this.pendingBatches > 0) return;

        this.isEnded = true;
        this.canClick = false;
        this.isPlayingBoxAnimation = true;

        // Sau khi hộp bị ẩn, ItemSpawnManager.HasSpawnSource() tự trả false (node inactive)
        // nên item spawn tiếp (Continuous mode) sẽ hiện tại chỗ trong vùng spawn.
        this.playAnim("4-End", false, () => {
            this.isPlayingBoxAnimation = false;
            if (this.hideBoxWhenEmpty) {
                this.node.active = false;
            }
        });
    }

    private playAnim(animName: string, loop: boolean = false, onComplete?: () => void): void {
        // Mỗi lần đổi anim tăng token; callback của anim cũ (đã bị anim mới đè) sẽ bị bỏ qua
        const token = ++this.animToken;
        const guarded = onComplete
            ? () => { if (token === this.animToken) onComplete(); }
            : undefined;

        if (this.graphicController) {
            this.graphicController.ChangeAnim(animName, loop, guarded);
            return;
        }

        if (this.skeletonAnimation) {
            try {
                const trackEntry = this.skeletonAnimation.setAnimation(0, animName, loop);
                if (!loop && guarded) {
                    const duration = (trackEntry && trackEntry.animation) ? trackEntry.animation.duration : 0.5;
                    this.scheduleOnce(guarded, duration);
                }
            } catch (e) {
                console.error(`❌ [ItemBox] Lỗi play spine anim '${animName}':`, e);
                guarded?.();
            }
            return;
        }

        guarded?.();
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
