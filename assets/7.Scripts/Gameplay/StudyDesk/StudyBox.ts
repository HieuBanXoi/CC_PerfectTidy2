import { _decorator, Component, Enum, EventTouch, input, Input, macro, math, Node, sp, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { ItemSpawnManager } from '../Items/Snapping/ItemSpawnManager';
import { ItemState } from '../Items/Snapping/ItemSnap';
import { HandTutManager } from '../Systems/HandTutManager';
import { HandHintPlayer } from '../Systems/HandHintPlayer';
import { HandHintRequest, HandHintSource, IdleHandHint } from '../Systems/IdleHandHint';
import { GameManager } from '../Systems/GameManager';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { StarSpark } from '../Effects/StarSpark';
import { TutorialPopup } from './TutorialPopup';

const { ccclass, property } = _decorator;

export enum BoxAppearTrigger {
    /** Có ItemCleanManager còn bước dọn: đợi dọn xong. Không có / không có bước nào: xuất hiện ngay khi vào game. */
    Auto = 0,
    /** Luôn xuất hiện ngay khi vào game. */
    OnStart = 1,
    /** Chỉ xuất hiện khi gọi Appear() (từ code hoặc Ply_Event). */
    Manual = 2,
}
Enum(BoxAppearTrigger);

export enum BoxVisualMode {
    /** Hộp bằng 2 sprite (đóng / mở), hiệu ứng bằng tween. */
    Sprite = 0,
    /** Hộp bằng Spine: dùng các anim của spine (Drop, ready, OPEN, click, End). */
    Spine = 1,
}
Enum(BoxVisualMode);

/** Một lần bấm đang chờ tới đúng frame (tween / event spine) mới cho item bay ra. */
interface PendingSpawn {
    count: number;
    isFirst: boolean;
}

/**
 * Hộp đồ:
 * 1. Xuất hiện (theo appearTrigger): phi từ dưới lên (Spine: anim Drop), rung chờ bấm; lâu không bấm thì hiện tay gợi ý.
 * 2. Bấm lần đầu: nhún, nảy, đổi sang sprite mở (Spine: anim OPEN), ra firstClickSpawnCount item (0 = hết).
 * 3. Các lần bấm sau: punch (Spine: anim click), ra nextClickSpawnCount item. Bấm nhanh / giữ tay thì punch liên tục,
 *    item bay ra liên tục, không cần đợi đợt trước đáp. Hết item thì hộp biến mất (Spine: anim End).
 * 4. Đợt đầu đáp xong thì bật popup Tutorial (nếu có); thu popup vào icon rồi mới hiện tay gợi ý kéo item.
 *
 * Độc lập: ItemCleanManager / TutorialPopup đều tuỳ chọn. Item do ItemSpawnManager spawn (không có thì hộp chỉ mở rồi ẩn).
 * Đặt component trên node luôn active (ví dụ Manager); node hộp có thể để inactive trên scene.
 */
@ccclass('StudyBox')
export class StudyBox extends Component implements HandHintSource {
    /** Thứ tự ưu tiên trong IdleHandHint: sau gợi ý kéo item và mở cánh tủ. */
    public static readonly HINT_PRIORITY = 20;


    // ==================== NODES ====================

    @property({ type: Node, tooltip: 'Node hộp (Box). Ẩn lúc đầu, xuất hiện theo appearTrigger.' })
    public box: Node | null = null;

    @property({ type: Enum(BoxVisualMode), tooltip: 'Sprite: 2 sprite đóng / mở + tween. Spine: dùng anim của spine cho mượt.' })
    public visualMode: BoxVisualMode = BoxVisualMode.Sprite;

    @property({
        type: Node, tooltip: 'Sprite hộp đóng (Sealed_cardboard_box).',
        visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Sprite; }
    })
    public closedNode: Node | null = null;

    @property({
        type: Node, tooltip: 'Sprite hộp mở (Open_top_carton). Ẩn lúc đầu.',
        visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Sprite; }
    })
    public openNode: Node | null = null;

    // ==================== SPINE ====================

    @property({
        type: sp.Skeleton, tooltip: 'Spine hộp (box-ingame). Để trống: tự tìm trong node box.',
        visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; }
    })
    public spine: sp.Skeleton | null = null;

    @property({
        tooltip: 'Anim pose nền chạy ở track 0 (ví dụ Setup-A-5). Để trống: giữ anim đang chọn trên component Skeleton.',
        visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; }
    })
    public spineSetupAnim = '';

    @property({ tooltip: 'Anim hộp rơi xuống khi xuất hiện.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineDropAnim = '0-Drop';

    @property({ tooltip: 'Anim lặp khi hộp đóng chờ bấm.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineReadyAnim = '1-ready-Loop';

    @property({ tooltip: 'Anim mở nắp (bấm lần đầu).', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineOpenAnim = '2-OPEN';

    @property({ tooltip: 'Anim lặp khi hộp đã mở chờ bấm tiếp.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineOpenLoopAnim = '3-OPEN-loop';

    @property({ tooltip: 'Anim punch mỗi lần bấm sau khi đã mở.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineClickAnim = '3-OPEN-click';

    @property({ tooltip: 'Anim kết thúc khi hộp hết item. Để trống: thu nhỏ biến mất như mode Sprite.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineEndAnim = '4-End';

    @property({ tooltip: 'Tên event spine báo frame item bật ra (OPEN / click). Không có event: item ra sau spineSpawnFallback giây.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineSpawnEvent = 'Item-A';

    @property({ min: 0, tooltip: 'Anim không bắn event: chờ bao lâu (giây) sau khi bấm thì cho item ra.', visible(this: StudyBox) { return this.visualMode === BoxVisualMode.Spine; } })
    public spineSpawnFallback = 0.6;

    @property({ type: Node, tooltip: 'Điểm item nhảy ra. Để trống: node hộp.' })
    public spawnPoint: Node | null = null;

    // ==================== LIÊN KẾT HỆ THỐNG (tuỳ chọn) ====================

    @property({ type: Enum(BoxAppearTrigger), tooltip: 'Khi nào hộp xuất hiện.' })
    public appearTrigger: BoxAppearTrigger = BoxAppearTrigger.Auto;

    @property({ type: ItemCleanManager, tooltip: 'Dùng với appearTrigger = Auto. Để trống: ItemCleanManager.Ins (không có cũng được).' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: ItemSpawnManager, tooltip: 'Nguồn item. Để trống: ItemSpawnManager.Ins.' })
    public spawnManager: ItemSpawnManager | null = null;

    @property({ type: TutorialPopup, tooltip: 'Popup Tutorial bật lên sau khi đợt item đầu đáp xuống. Để trống: không có popup.' })
    public tutorialPopup: TutorialPopup | null = null;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi item đáp xuống hết rồi mới bật popup Tutorial.' })
    public tutorialDelay = 0.2;

    // ==================== XUẤT HIỆN ====================

    @property({ min: 0, tooltip: 'Chờ (giây) trước khi hộp phi lên.' })
    public appearDelay = 0.2;

    @property({ tooltip: 'Quãng đường hộp phi từ dưới lên (local).' })
    public flyDistance = 900;

    @property({ min: 0.01, tooltip: 'Thời gian hộp phi lên (giây).' })
    public flyDuration = 0.5;

    @property({ type: Enum(FxType), tooltip: 'Sound khi hộp phi lên.' })
    public appearFxType: FxType = FxType.CleanItemAppear;

    @property({ min: 0, tooltip: 'Góc rung (độ) khi hộp chờ bấm.' })
    public shakeAngle = 6;

    @property({ min: 0.01, tooltip: 'Thời gian 1 lần rung (giây).' })
    public shakeDuration = 0.4;

    @property({ min: 0, tooltip: 'Nghỉ (giây) giữa 2 lần rung.' })
    public shakeInterval = 0.8;

    // ==================== BẤM HỘP ====================

    @property({ tooltip: 'Độ cao hộp nảy lên khi bấm mở (local).' })
    public bounceHeight = 60;

    @property({ type: Enum(FxType), tooltip: 'Sound khi bấm hộp.' })
    public clickFxType: FxType = FxType.Click;

    @property({ type: Enum(FxType), tooltip: 'Sound khi hộp bật mở.' })
    public openFxType: FxType = FxType.Blink;

    @property({ tooltip: 'Bắn hiệu ứng sao khi hộp mở.' })
    public playOpenVfx = true;

    @property({ tooltip: 'Sau khi mở: bấm liên tục được, không cần đợi đợt item trước đáp xuống.' })
    public allowRapidClick = true;

    @property({ min: 0, tooltip: 'Khoảng cách tối thiểu (giây) giữa 2 lần punch.', visible(this: StudyBox) { return this.allowRapidClick; } })
    public clickCooldown = 0.08;

    @property({ min: 0, tooltip: 'Giữ tay trên hộp thì tự punch liên tục mỗi chừng này giây. 0 = tắt.' })
    public holdRepeatInterval = 0.15;

    @property({ min: 0, tooltip: 'Giữ tay bao lâu (giây) thì bắt đầu punch liên tục.', visible(this: StudyBox) { return this.holdRepeatInterval > 0; } })
    public holdRepeatDelay = 0.3;

    // ==================== ITEM BAY RA ====================

    @property({ min: 0, tooltip: 'Số item nhảy ra ở lần bấm đầu tiên (mở hộp). 0 = ra hết.' })
    public firstClickSpawnCount = 0;

    @property({ min: 1, tooltip: 'Số item nhảy ra ở mỗi lần bấm tiếp theo (hộp còn item thì vẫn ở lại cho bấm tiếp).' })
    public nextClickSpawnCount = 1;

    @property({ min: 0.01, tooltip: 'Thời gian mỗi item bay ra (giây).' })
    public itemFlyDuration = 0.55;

    @property({ tooltip: 'Độ cao cung nhảy của item (local).' })
    public itemJumpHeight = 220;

    @property({ min: 0, tooltip: 'Độ trễ (giây) giữa 2 item nhảy ra liên tiếp.' })
    public itemStagger = 0.02;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi item cuối cùng trong hộp nhảy ra rồi hộp mới biến mất.' })
    public hideDelay = 0.25;

    // ==================== MỜ KHI KÉO ITEM LẠI GẦN ====================

    @property({ tooltip: 'Đang kéo item lại gần hộp thì hộp mờ dần (không che chỗ đặt phía sau); kéo ra xa hoặc thả item thì rõ lại.' })
    public fadeWhenDragNear = true;

    @property({
        min: 0, tooltip: 'Khoảng cách (world) tính từ mép hộp: item kéo vào trong vùng này thì hộp mờ đi.',
        visible(this: StudyBox) { return this.fadeWhenDragNear; }
    })
    public dragFadeDistance = 120;

    @property({
        range: [0, 255, 1], slide: true, tooltip: 'Độ mờ của hộp khi item kéo lại gần (0 = ẩn hẳn, 255 = rõ).',
        visible(this: StudyBox) { return this.fadeWhenDragNear; }
    })
    public dragFadeOpacity = 0;

    @property({
        min: 0.01, tooltip: 'Thời gian mờ đi / rõ lại (giây).',
        visible(this: StudyBox) { return this.fadeWhenDragNear; }
    })
    public dragFadeDuration = 0.2;

    // ==================== TAY GỢI Ý BẤM HỘP ====================

    @property({ min: 0, tooltip: 'Không có IdleHandHint: sau bao lâu (giây) không bấm thì hiện tay gợi ý mở hộp. 0 = không gợi ý. Có IdleHandHint thì nó lo việc này.' })
    public handHintDelay = 3;

    @property({ type: Node, tooltip: 'Node tay gợi ý. Để trống: HandTutManager.Ins.handNode.' })
    public handNode: Node | null = null;

    // ==================== EVENTS ====================

    @property({ type: Ply_Event, tooltip: 'Gọi khi bấm mở hộp (lần đầu).' })
    public onOpened: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi mỗi lần đợt item vừa bấm ra đã đáp xuống hết.' })
    public onAllItemsLanded: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi hộp hết item và bắt đầu biến mất.' })
    public onEmptied: Ply_Event = new Ply_Event();

    // ==================== STATE ====================

    private _appeared = false;
    private _ready = false;      // Hộp đã đáp, đang chờ bấm
    private _opened = false;     // Đã bấm mở lần đầu
    private _opening = false;    // Đang anim mở nắp, chặn bấm tới khi đợt đầu bay ra
    private _hiding = false;     // Hết item, đang biến mất
    private _inFlight = 0;       // Số đợt item đang bay
    private _cooldown = 0;
    private readonly _pending: PendingSpawn[] = [];
    private _touchOnBox = false;  // Lượt chạm này bắt đầu trong hộp
    private _touchOnItem = false; // Lượt chạm này bắt đầu trên 1 item -> để item kéo, không tính bấm hộp
    private _holdFired = false;   // Lượt chạm này đã punch bằng giữ tay -> nhả tay không tính thêm 1 lần bấm
    private readonly _touchStart = new Vec2();
    private readonly _touchNow = new Vec2();
    private readonly _restPos = new Vec3();
    private readonly _restScale = new Vec3(1, 1, 1);
    private _restAngle = 0;
    private readonly _onAllCleaned = () => this.Appear();

    public get IsOpened(): boolean { return this._opened; }

    public resetInEditor(): void {
        if (!this.onOpened) this.onOpened = new Ply_Event();
        if (!this.onAllItemsLanded) this.onAllItemsLanded = new Ply_Event();
        if (!this.onEmptied) this.onEmptied = new Ply_Event();
    }

    // ==================== LIFECYCLE ====================

    protected onLoad(): void {
        const box = this.box;
        if (!box) {
            console.warn('[StudyBox] Chưa gán node box.');
            return;
        }
        this._restPos.set(box.position);
        this._restScale.set(box.scale);
        this._restAngle = box.angle;
        box.active = false;
        this.initVisualMode();
        this.setLidOpen(false);
    }

    protected onEnable(): void {
        IdleHandHint.Register(this, StudyBox.HINT_PRIORITY);
    }

    protected onDisable(): void {
        IdleHandHint.Unregister(this);
    }

    protected start(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        // Bind ở start: ItemCleanManager.Ins đã được gán trong onLoad của nó.
        if (this.shouldWaitForClean()) {
            this.CleanManager!.onAllItemsCleaned.addListener(this._onAllCleaned);
        } else if (this.appearTrigger !== BoxAppearTrigger.Manual) {
            this.Appear();
        }
    }

    protected onDestroy(): void {
        this.CleanManager?.onAllItemsCleaned.removeListener(this._onAllCleaned);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.stopHoldRepeat();
        this.hideHandHint();
    }

    protected update(dt: number): void {
        if (this._cooldown > 0) this._cooldown -= dt;
        this.updateDragFade(dt);
    }

    // ==================== VISUAL MODE ====================

    private get IsSpine(): boolean {
        return this.visualMode === BoxVisualMode.Spine && !!this.spine;
    }

    /** Spine: bật node spine, tắt 2 sprite, nghe event bật item. Sprite: tắt node spine (nếu có). */
    private initVisualMode(): void {
        if (!this.spine && this.box) this.spine = this.box.getComponentInChildren(sp.Skeleton);
        const useSpine = this.visualMode === BoxVisualMode.Spine;
        if (useSpine && !this.spine) {
            console.warn('[StudyBox] visualMode = Spine nhưng không tìm thấy sp.Skeleton trong box, dùng Sprite.');
            this.visualMode = BoxVisualMode.Sprite;
        }

        if (this.spine) this.spine.node.active = this.IsSpine;
        if (!this.IsSpine) return;

        if (this.closedNode) this.closedNode.active = false;
        if (this.openNode) this.openNode.active = false;
        // Lúc này box còn inactive (Skeleton chưa khởi tạo) -> pose nền set ở Appear. Listener thì lưu được luôn.
        this.spine!.setEventListener((_entry: any, event: any) => {
            if (event?.data?.name === this.spineSpawnEvent) this.onSpineSpawnEvent();
        });
    }

    /**
     * Chạy anim chính ở track 1 (track 0 giữ pose nền Setup-A-x; anim chính đè lên các bone nó key).
     * loopAfter: anim lặp nối tiếp. Trả về thời lượng anim (0 nếu không có anim đó).
     */
    private playSpine(name: string, loop: boolean, loopAfter = ''): number {
        const skel = this.spine;
        if (!skel || !name) return 0;
        const anim = skel.findAnimation(name);
        if (!anim) {
            console.warn(`[StudyBox] Spine không có anim "${name}".`);
            return 0;
        }
        skel.setAnimation(1, name, loop);
        if (loopAfter && skel.findAnimation(loopAfter)) skel.addAnimation(1, loopAfter, true, 0);
        return anim.duration;
    }

    /** Auto + có ItemCleanManager còn bước dọn chưa xong -> đợi onAllItemsCleaned. */
    private shouldWaitForClean(): boolean {
        if (this.appearTrigger !== BoxAppearTrigger.Auto) return false;
        const clean = this.CleanManager;
        return !!clean && !clean.IsCompleted && clean.items.some(item => !!item);
    }

    // ==================== XUẤT HIỆN ====================

    /** Hộp phi từ dưới lên vị trí đặt trên scene, rồi rung chờ bấm. */
    public Appear(): void {
        const box = this.box;
        if (!box || this._appeared) return;
        this._appeared = true;

        this.scheduleOnce(() => {
            const rest = this._restPos;
            const s = this._restScale;
            Tween.stopAllByTarget(box);
            box.active = true;

            if (this.IsSpine) {
                // Spine: đứng tại chỗ, anim Drop lo phần rơi xuống, xong thì lặp anim ready.
                box.setPosition(rest);
                box.angle = this._restAngle;
                box.setScale(s);
                const skel = this.spine!;
                if (this.spineSetupAnim && skel.findAnimation(this.spineSetupAnim)) skel.setAnimation(0, this.spineSetupAnim, true);
                Ply_SoundManager.Ins?.PlayFx(this.appearFxType);
                const dur = this.playSpine(this.spineDropAnim, false, this.spineReadyAnim);
                if (dur <= 0) this.playSpine(this.spineReadyAnim, true);
                this.scheduleOnce(() => this.onLanded(), dur);
                return;
            }

            box.setPosition(rest.x, rest.y - this.flyDistance, rest.z);
            box.angle = this._restAngle - 25;
            box.setScale(s.x * 0.9, s.y * 1.15, s.z);
            Ply_SoundManager.Ins?.PlayFx(this.appearFxType);
            tween(box)
                .to(this.flyDuration, { position: rest, angle: this._restAngle }, { easing: 'backOut' })
                // Đáp xuống: bẹp nhẹ rồi nảy về scale gốc.
                .to(0.1, { scale: this.scaled(1.12, 0.88) }, { easing: 'quadOut' })
                .to(0.2, { scale: s }, { easing: 'backOut' })
                .call(() => this.onLanded())
                .start();
        }, this.appearDelay);
    }

    private onLanded(): void {
        this._ready = true;
        if (!this.IsSpine) this.startShake();   // Spine: anim ready-Loop đã tự lắc
        this.scheduleHandHint();
    }

    // ==================== BẤM HỘP ====================

    /**
     * Nghe touch toàn cục (như InputManager) thay vì đăng ký trên node hộp: node có listener sẽ nuốt touch,
     * InputManager không nhận được -> không kéo được item nằm đè lên hộp.
     * Bấm hộp = chạm & nhả trong hộp, không trượt xa, và lúc chạm KHÔNG trúng item đang chờ (ưu tiên kéo item).
     */
    private onTouchStart(event: EventTouch): void {
        event.getUILocation(this._touchStart);
        this._touchNow.set(this._touchStart);
        this._touchOnBox = this.isPointOnBox(this._touchStart);
        this._touchOnItem = this._touchOnBox && this.isTouchOnWaitingItem(this._touchStart);
        this._holdFired = false;
        if (this._touchOnBox && !this._touchOnItem) this.startHoldRepeat();
    }

    private onTouchMove(event: EventTouch): void {
        event.getUILocation(this._touchNow);
    }

    private onTouchEnd(event: EventTouch): void {
        const end = event.getUILocation();
        const isTap = Vec2.distance(this._touchStart, end) <= 25;
        const valid = this._touchOnBox && !this._touchOnItem && !this._holdFired && isTap && this.isPointOnBox(end);
        this._touchOnBox = false;
        this.stopHoldRepeat();
        if (valid) this.onBoxClick();
    }

    private onTouchCancel(): void {
        this._touchOnBox = false;
        this.stopHoldRepeat();
    }

    // ----- Giữ tay: punch liên tục -----

    private startHoldRepeat(): void {
        this.stopHoldRepeat();
        if (this.holdRepeatInterval <= 0) return;
        this.schedule(this.onHoldTick, this.holdRepeatInterval, macro.REPEAT_FOREVER, this.holdRepeatDelay);
    }

    private stopHoldRepeat(): void {
        this.unschedule(this.onHoldTick);
    }

    private onHoldTick = (): void => {
        // Kéo tay ra khỏi hộp / trượt xa (đang kéo item) thì dừng.
        if (!this._touchOnBox || Vec2.distance(this._touchStart, this._touchNow) > 25 || !this.isPointOnBox(this._touchNow)) {
            this.stopHoldRepeat();
            return;
        }
        this._holdFired = true;
        this.onBoxClick();
    };

    private isPointOnBox(uiPos: Vec2): boolean {
        const box = this.box;
        return !!box?.activeInHierarchy && this.containsPoint(box.getComponent(UITransform), uiPos);
    }

    private containsPoint(ut: UITransform | null, uiPos: Vec2): boolean {
        if (!ut) return false;
        const local = ut.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
        const left = -ut.anchorX * ut.width, bottom = -ut.anchorY * ut.height;
        return local.x >= left && local.x <= left + ut.width && local.y >= bottom && local.y <= bottom + ut.height;
    }

    /**
     * Cùng cách InputManager tìm item để kéo: item đang chờ, có UITransform chứa điểm chạm.
     * Tính cả OnDrag vì InputManager có thể nhận touch này trước và đã bắt đầu kéo item.
     */
    private isTouchOnWaitingItem(uiPos: Vec2): boolean {
        return !!this.Spawner?.dynamicItems.some(item => !!item?.enabled
            && (item.currentState === ItemState.Waiting || item.currentState === ItemState.OnDrag)
            && item.node.activeInHierarchy
            && this.containsPoint(item.getComponent(UITransform), uiPos));
    }

    private onBoxClick(): void {
        if (!this._ready || this._opening || this._hiding) return;
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) return;
        if (!this._opened) this.Open();
        else this.SpawnMore();
    }

    /** Bấm lần đầu: nhún, nảy lên, đổi sprite mở (Spine: anim OPEN), ra đợt item đầu. */
    public Open(): void {
        const box = this.box;
        if (!box || this._opened) return;
        this._opened = true;
        this._opening = true;
        this.stopShake();
        this.hideHandHint();
        this.playClickFeedback();
        this.onOpened.invoke();
        this.queueSpawn(this.firstClickSpawnCount, true);

        if (this.IsSpine) {
            // Item bay ra ở event Item-A của anim OPEN (fallback: hết anim).
            const dur = this.playSpine(this.spineOpenAnim, false, this.spineOpenLoopAnim);
            this.scheduleSpawnFallback(dur > 0 ? dur : 0);
            return;
        }

        const rest = this._restPos;
        Tween.stopAllByTarget(box);
        box.setPosition(rest);
        box.angle = this._restAngle;
        tween(box)
            .to(0.14, { scale: this.scaled(1.2, 0.78) }, { easing: 'quadOut' })
            .to(0.18, { scale: this.scaled(0.88, 1.2), position: new Vec3(rest.x, rest.y + this.bounceHeight, rest.z) }, { easing: 'quadOut' })
            .call(() => this.flushPendingSpawns())
            .to(0.16, { scale: this._restScale, position: rest }, { easing: 'quadIn' })
            .to(0.08, { scale: this.scaled(1.1, 0.9) }, { easing: 'quadOut' })
            .to(0.14, { scale: this._restScale }, { easing: 'backOut' })
            .start();
    }

    /**
     * Các lần bấm sau khi đã mở: punch (Spine: anim click) rồi ra thêm nextClickSpawnCount item.
     * allowRapidClick: bấm dồn được, mỗi lần bấm khởi động lại punch, item bay ra liên tục.
     */
    public SpawnMore(): void {
        const box = this.box;
        if (!box || !this._opened || this._opening || this._hiding) return;
        if (this.allowRapidClick ? this._cooldown > 0 : (this._inFlight > 0 || this._pending.length > 0)) return;
        if ((this.Spawner?.GetRemainingItemCount() ?? 0) - this.pendingCount() <= 0) return;
        this._cooldown = this.clickCooldown;

        // Punch trước chưa tới frame ra item mà đã bị bấm đè: cho item của nó ra luôn, không bị mất.
        this.flushPendingSpawns();
        this.hideHandHint();
        this.playClickFeedback();
        this.queueSpawn(this.nextClickSpawnCount, false);

        if (this.IsSpine) {
            const dur = this.playSpine(this.spineClickAnim, false, this.spineOpenLoopAnim);
            this.scheduleSpawnFallback(dur > 0 ? Math.min(dur, this.spineSpawnFallback) : 0);
            return;
        }

        Tween.stopAllByTarget(box);
        box.setPosition(this._restPos);
        box.setScale(this._restScale);
        tween(box)
            .to(0.08, { scale: this.scaled(1.15, 0.85) }, { easing: 'quadOut' })
            .call(() => this.flushPendingSpawns())
            .to(0.16, { scale: this._restScale }, { easing: 'backOut' })
            .start();
    }

    private playClickFeedback(): void {
        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        GameManager.Ins?.ResetInactivityTimer(null);
    }

    // ==================== ITEM BAY RA ====================

    private queueSpawn(count: number, isFirst: boolean): void {
        this._pending.push({ count, isFirst });
    }

    private pendingCount(): number {
        let total = 0;
        for (const p of this._pending) total += p.count > 0 ? p.count : Number.MAX_SAFE_INTEGER;
        return total;
    }

    /** Event Item-A của spine: cho 1 lần bấm đang chờ ra item. */
    private onSpineSpawnEvent(): void {
        const next = this._pending.shift();
        if (next) this.spawnRequest(next);
        if (this._pending.length === 0) this.unschedule(this.flushPendingSpawns);
    }

    /** Anim không bắn event (hoặc bị cắt ngang): sau delay giây vẫn cho item ra. */
    private scheduleSpawnFallback(delay: number): void {
        this.unschedule(this.flushPendingSpawns);
        this.scheduleOnce(this.flushPendingSpawns, Math.min(delay, this.spineSpawnFallback));
    }

    private flushPendingSpawns = (): void => {
        this.unschedule(this.flushPendingSpawns);
        while (this._pending.length > 0) this.spawnRequest(this._pending.shift()!);
    };

    private spawnRequest(req: PendingSpawn): void {
        if (req.isFirst) this.openLid();
        this.spawnItems(req.count, req.isFirst);
    }

    private openLid(): void {
        this._opening = false;
        this.setLidOpen(true);
        Ply_SoundManager.Ins?.PlayFx(this.openFxType);
        this.spawnOpenVfx();
    }

    /** Ra requested item (<= 0: ra hết). Hết item trong hộp thì hộp biến mất, còn thì ở lại cho bấm tiếp. */
    private spawnItems(requested: number, isFirst: boolean): void {
        if (this._hiding) return;
        const spawner = this.Spawner;
        const remaining = spawner?.GetRemainingItemCount() ?? 0;
        if (!spawner || remaining <= 0) {
            if (!spawner) console.warn('[StudyBox] Không có ItemSpawnManager để spawn item.');
            this.hideBox(0);
            return;
        }

        const count = requested > 0 ? Math.min(requested, remaining) : remaining;
        const from = (this.spawnPoint ?? this.box!).worldPosition.clone();
        this._inFlight++;
        // Item bay ra các vị trí rải đều trong vùng spawn, hạn chế đè nhau.
        spawner.SpawnBatchFromSource(from, count, this.itemFlyDuration, this.itemJumpHeight, this.itemStagger,
            () => this.onItemsLanded(spawner, isFirst));
        if (count >= remaining) this.hideBox(count * this.itemStagger + this.hideDelay);
    }

    private onItemsLanded(spawner: ItemSpawnManager, isFirst: boolean): void {
        this._inFlight = Math.max(0, this._inFlight - 1);
        this.onAllItemsLanded.invoke();

        // Tay gợi ý kéo item chỉ hiện sau khi người chơi thu Tutorial (đợt đầu) vào icon.
        const popup = this.tutorialPopup;
        if (!isFirst || !popup || popup.HasShown) {
            if (this._inFlight === 0) spawner.TriggerImmediateHandTut();
            return;
        }
        const onMinimized = () => {
            popup.onMinimized.removeListener(onMinimized);
            spawner.TriggerImmediateHandTut();
        };
        popup.onMinimized.addListener(onMinimized);
        this.scheduleOnce(() => popup.Show(), this.tutorialDelay);
    }

    // ==================== HỘP ====================

    private setLidOpen(open: boolean): void {
        if (this.IsSpine) return;   // Spine: nắp mở theo anim OPEN
        if (this.closedNode) this.closedNode.active = !open;
        if (this.openNode) this.openNode.active = open;
    }

    private hideBox(delay: number): void {
        const box = this.box;
        if (!box || this._hiding) return;
        this._hiding = true;
        this._ready = false;
        this._pending.length = 0;
        this.unschedule(this.flushPendingSpawns);
        this.stopHoldRepeat();
        this.hideHandHint();
        this.onEmptied.invoke();

        const opacity = box.getComponent(UIOpacity) ?? box.addComponent(UIOpacity);
        opacity.opacity = 255;   // Có thể đang mờ do kéo item lại gần

        if (this.IsSpine && this.spine!.findAnimation(this.spineEndAnim)) {
            // Spine: đợi punch cuối chạy xong rồi chạy anim End, hết anim thì mờ dần và tắt.
            this.scheduleOnce(() => {
                const dur = this.playSpine(this.spineEndAnim, false);
                tween(opacity)
                    .delay(dur)
                    .to(0.2, { opacity: 0 })
                    .call(() => { box.active = false; })
                    .start();
            }, Math.max(delay, 0.3));
            return;
        }

        tween(box)
            .delay(delay)
            .to(0.3, { scale: Vec3.ZERO }, { easing: 'backIn' })
            .call(() => { box.active = false; })
            .start();
        tween(opacity)
            .delay(delay + 0.15)
            .to(0.15, { opacity: 0 })
            .start();
    }

    // ==================== MỜ KHI KÉO ITEM LẠI GẦN ====================

    /** Item đang kéo ở gần hộp -> mờ dần; kéo ra xa / thả item -> rõ dần. Chỉ chạy khi hộp đang đứng chờ bấm. */
    private updateDragFade(dt: number): void {
        const box = this.box;
        if (!this.fadeWhenDragNear || !this._ready || !box?.activeInHierarchy) return;

        const dragging = this.Spawner?.dynamicItems.find(item => item?.currentState === ItemState.OnDrag) ?? null;
        const faded = !!dragging && this.isNearBox(dragging.node.worldPosition);

        const opacity = box.getComponent(UIOpacity) ?? box.addComponent(UIOpacity);
        const target = faded ? this.dragFadeOpacity : 255;
        const step = 255 * dt / this.dragFadeDuration;
        opacity.opacity = Math.round(math.clamp(opacity.opacity + math.clamp(target - opacity.opacity, -step, step), 0, 255));
    }

    private isNearBox(worldPos: Vec3): boolean {
        const rect = this.box?.getComponent(UITransform)?.getBoundingBoxToWorld();
        if (!rect) return false;
        const d = this.dragFadeDistance;
        return worldPos.x >= rect.xMin - d && worldPos.x <= rect.xMax + d
            && worldPos.y >= rect.yMin - d && worldPos.y <= rect.yMax + d;
    }

    private startShake(): void {
        const box = this.box;
        if (!box) return;
        const a = this._restAngle;
        const step = this.shakeDuration / 6;
        Tween.stopAllByTarget(box);
        box.angle = a;
        tween(box)
            .to(step, { angle: a + this.shakeAngle }, { easing: 'sineOut' })
            .to(step * 2, { angle: a - this.shakeAngle }, { easing: 'sineInOut' })
            .to(step * 2, { angle: a + this.shakeAngle * 0.5 }, { easing: 'sineInOut' })
            .to(step, { angle: a }, { easing: 'sineIn' })
            .delay(this.shakeInterval)
            .union()
            .repeatForever()
            .start();
    }

    private stopShake(): void {
        if (!this.box) return;
        Tween.stopAllByTarget(this.box);
        this.box.angle = this._restAngle;
    }

    private spawnOpenVfx(): void {
        const box = this.box;
        if (!this.playOpenVfx || !box?.parent) return;
        const effect = World.instance?.poolManager?.spawnType<StarSpark>(PoolType.StarVFX, box.worldPosition);
        if (!effect) return;
        effect.node.setParent(box.parent);
        effect.node.setWorldPosition(box.worldPosition);
        effect.node.setSiblingIndex(box.parent.children.length - 1);
        effect.PlaySpawn();
    }

    private scaled(sx: number, sy: number): Vec3 {
        const s = this._restScale;
        return new Vec3(s.x * sx, s.y * sy, s.z);
    }

    // ==================== TAY GỢI Ý BẤM HỘP ====================

    /** HandHintSource: hộp đang chờ bấm và còn item -> nhấn vào hộp. */
    public GetHandHint(): HandHintRequest | null {
        const box = this.box;
        if (!box || !this.canClickForHint()) return null;
        return { kind: 'tap', target: box, canContinue: () => this.canClickForHint() };
    }

    private canClickForHint(): boolean {
        if (!this._ready || this._opening || this._hiding || this._inFlight > 0 || !this.box?.activeInHierarchy) return false;
        return !this._opened || (this.Spawner?.GetRemainingItemCount() ?? 0) > 0;
    }

    /** Không có IdleHandHint: tự hẹn giờ gợi ý mở hộp sau handHintDelay. */
    private scheduleHandHint(): void {
        const idle = IdleHandHint.Ins;
        if (this.handHintDelay <= 0 || (idle?.isValid && idle.enabledInHierarchy)) return;
        this.unschedule(this.showHandHint);
        this.scheduleOnce(this.showHandHint, this.handHintDelay);
    }

    private showHandHint = (): void => {
        const player = this.HandPlayer;
        const box = this.box;
        if (!player || !box || this._opened) return;
        // Đồng bộ với HandTutManager: tắt gợi ý của nó (nếu đang hiện) trước khi dùng tay.
        HandTutManager.Ins?.ResetHandTutDelay();
        player.PlayTap(this, box, { pressScale: 0.8, pressDuration: 0.3, waitDuration: 0.3 }, () => !this._opened);
    };

    private hideHandHint(): void {
        this.unschedule(this.showHandHint);
        this.HandPlayer?.Stop(this);
    }

    // ==================== REFS ====================

    private get HandPlayer(): HandHintPlayer | null {
        return HandHintPlayer.For(this.handNode ?? HandTutManager.Ins?.handNode);
    }

    private get CleanManager(): ItemCleanManager | null {
        return this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
    }

    private get Spawner(): ItemSpawnManager | null {
        return this.spawnManager ?? ItemSpawnManager.Ins as ItemSpawnManager | null;
    }
}
