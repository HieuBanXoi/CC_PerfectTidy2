import { _decorator, Component, Enum, EventTouch, input, Input, math, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
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

/**
 * Hộp đồ:
 * 1. Xuất hiện (theo appearTrigger): phi từ dưới lên, rung rung chờ bấm; lâu không bấm thì hiện tay gợi ý.
 * 2. Bấm lần đầu: nhún, nảy, đổi sang sprite mở, ra firstClickSpawnCount item (0 = hết).
 * 3. Các lần bấm sau: nhún nhẹ, ra nextClickSpawnCount item. Hết item thì hộp thu nhỏ biến mất.
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

    @property({ type: Node, tooltip: 'Sprite hộp đóng (Sealed_cardboard_box).' })
    public closedNode: Node | null = null;

    @property({ type: Node, tooltip: 'Sprite hộp mở (Open_top_carton). Ẩn lúc đầu.' })
    public openNode: Node | null = null;

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
    private _spawning = false;   // Đợt item đang bay, chặn bấm dồn
    private _touchOnBox = false;  // Lượt chạm này bắt đầu trong hộp
    private _touchOnItem = false; // Lượt chạm này bắt đầu trên 1 item -> để item kéo, không tính bấm hộp
    private readonly _touchStart = new Vec2();
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
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
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
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        this.hideHandHint();
    }

    protected update(dt: number): void {
        this.updateDragFade(dt);
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
        this.startShake();
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
        this._touchOnBox = this.isPointOnBox(this._touchStart);
        this._touchOnItem = this._touchOnBox && this.isTouchOnWaitingItem(this._touchStart);
    }

    private onTouchEnd(event: EventTouch): void {
        const end = event.getUILocation();
        const isTap = Vec2.distance(this._touchStart, end) <= 25;
        const valid = this._touchOnBox && !this._touchOnItem && isTap && this.isPointOnBox(end);
        this._touchOnBox = false;
        if (valid) this.onBoxClick();
    }

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
        if (!this._ready || this._spawning) return;
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) return;
        if (!this._opened) this.Open();
        else this.SpawnMore();
    }

    /** Bấm lần đầu: nhún, nảy lên, đổi sprite mở, ra đợt item đầu. */
    public Open(): void {
        const box = this.box;
        if (!box || this._opened) return;
        this._opened = true;
        this._spawning = true;
        this.stopShake();
        this.hideHandHint();
        this.playClickFeedback();
        this.onOpened.invoke();

        const rest = this._restPos;
        Tween.stopAllByTarget(box);
        box.setPosition(rest);
        box.angle = this._restAngle;
        tween(box)
            .to(0.14, { scale: this.scaled(1.2, 0.78) }, { easing: 'quadOut' })
            .to(0.18, { scale: this.scaled(0.88, 1.2), position: new Vec3(rest.x, rest.y + this.bounceHeight, rest.z) }, { easing: 'quadOut' })
            .call(() => this.openLid())
            .to(0.16, { scale: this._restScale, position: rest }, { easing: 'quadIn' })
            .to(0.08, { scale: this.scaled(1.1, 0.9) }, { easing: 'quadOut' })
            .to(0.14, { scale: this._restScale }, { easing: 'backOut' })
            .start();
    }

    /** Các lần bấm sau khi đã mở: nhún nhẹ rồi ra thêm nextClickSpawnCount item. */
    public SpawnMore(): void {
        const box = this.box;
        if (!box || !this._opened || this._spawning) return;
        this._spawning = true;
        this.playClickFeedback();

        Tween.stopAllByTarget(box);
        box.setPosition(this._restPos);
        box.setScale(this._restScale);
        tween(box)
            .to(0.1, { scale: this.scaled(1.15, 0.85) }, { easing: 'quadOut' })
            .call(() => this.spawnItems(this.nextClickSpawnCount, false))
            .to(0.18, { scale: this._restScale }, { easing: 'backOut' })
            .start();
    }

    private openLid(): void {
        this.setLidOpen(true);
        Ply_SoundManager.Ins?.PlayFx(this.openFxType);
        this.spawnOpenVfx();
        this.spawnItems(this.firstClickSpawnCount, true);
    }

    private playClickFeedback(): void {
        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        GameManager.Ins?.ResetInactivityTimer(null);
    }

    // ==================== ITEM BAY RA ====================

    /** Ra requested item (<= 0: ra hết). Hết item trong hộp thì hộp biến mất, còn thì ở lại cho bấm tiếp. */
    private spawnItems(requested: number, isFirst: boolean): void {
        const spawner = this.Spawner;
        const remaining = spawner?.GetRemainingItemCount() ?? 0;
        if (!spawner || remaining <= 0) {
            if (!spawner) console.warn('[StudyBox] Không có ItemSpawnManager để spawn item.');
            this._spawning = false;
            this.hideBox(0);
            return;
        }

        const count = requested > 0 ? Math.min(requested, remaining) : remaining;
        const from = (this.spawnPoint ?? this.box!).worldPosition.clone();
        // Item bay ra các vị trí rải đều trong vùng spawn, hạn chế đè nhau.
        spawner.SpawnBatchFromSource(from, count, this.itemFlyDuration, this.itemJumpHeight, this.itemStagger,
            () => this.onItemsLanded(spawner, isFirst));
        if (count >= remaining) this.hideBox(count * this.itemStagger + this.hideDelay);
    }

    private onItemsLanded(spawner: ItemSpawnManager, isFirst: boolean): void {
        this._spawning = false;
        this.onAllItemsLanded.invoke();

        // Tay gợi ý kéo item chỉ hiện sau khi người chơi thu Tutorial (đợt đầu) vào icon.
        const popup = this.tutorialPopup;
        if (!isFirst || !popup || popup.HasShown) {
            spawner.TriggerImmediateHandTut();
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
        if (this.closedNode) this.closedNode.active = !open;
        if (this.openNode) this.openNode.active = open;
    }

    private hideBox(delay: number): void {
        const box = this.box;
        if (!box) return;
        this._ready = false;
        this.onEmptied.invoke();

        const opacity = box.getComponent(UIOpacity) ?? box.addComponent(UIOpacity);
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
        if (!this._ready || this._spawning || !this.box?.activeInHierarchy) return false;
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
