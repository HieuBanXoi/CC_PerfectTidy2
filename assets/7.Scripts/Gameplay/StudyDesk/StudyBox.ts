import { _decorator, Component, Enum, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { ItemSpawnManager } from '../Items/Snapping/ItemSpawnManager';
import { HandTutManager } from '../Systems/HandTutManager';
import { GameManager } from '../Systems/GameManager';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { StarSpark } from '../Effects/StarSpark';
import { TutorialPopup } from './TutorialPopup';

const { ccclass, property } = _decorator;

/**
 * Hộp đồ sau bước lau bàn:
 * 1. ItemCleanManager xong hết (nhặt rác + lau bàn) -> hộp phi từ dưới lên.
 * 2. Hộp rung rung chờ người chơi bấm.
 * 3. Bấm: hộp nhún, nảy lên, đổi sang sprite mở, toàn bộ item nhảy ra; hộp thu nhỏ rồi biến mất.
 * 4. Item đáp xuống hết thì bật popup Tutorial; thu Tutorial vào icon rồi mới hiện tay gợi ý kéo item.
 * Đặt component trên node luôn active (ví dụ Manager), node hộp có thể để inactive trên scene.
 */
@ccclass('StudyBox')
export class StudyBox extends Component {
    @property({ type: Node, tooltip: 'Node hộp (Box). Để inactive trên scene, xuất hiện sau khi lau bàn xong.' })
    public box: Node | null = null;

    @property({ type: Node, tooltip: 'Sprite hộp đóng (Sealed_cardboard_box).' })
    public closedNode: Node | null = null;

    @property({ type: Node, tooltip: 'Sprite hộp mở (Open_top_carton). Ẩn lúc đầu.' })
    public openNode: Node | null = null;

    @property({ type: Node, tooltip: 'Điểm item nhảy ra. Để trống: node hộp.' })
    public spawnPoint: Node | null = null;

    @property({ type: ItemCleanManager, tooltip: 'Để trống: ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: ItemSpawnManager, tooltip: 'Để trống: ItemSpawnManager.Ins.' })
    public spawnManager: ItemSpawnManager | null = null;

    @property({ type: TutorialPopup, tooltip: 'Popup Tutorial bật lên sau khi toàn bộ item trong hộp đã bay ra và đáp xuống. Để trống: không có popup.' })
    public tutorialPopup: TutorialPopup | null = null;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi lau xong rồi hộp mới phi lên.' })
    public appearDelay = 0.2;

    @property({ tooltip: 'Quãng đường hộp phi từ dưới lên (local).' })
    public flyDistance = 900;

    @property({ min: 0.01, tooltip: 'Thời gian hộp phi lên (giây).' })
    public flyDuration = 0.5;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi item đáp xuống hết rồi mới bật popup Tutorial.' })
    public tutorialDelay = 0.2;

    @property({ type: Enum(FxType), tooltip: 'Sound khi hộp phi lên.' })
    public appearFxType: FxType = FxType.CleanItemAppear;

    @property({ min: 0, tooltip: 'Góc rung (độ) khi hộp chờ bấm.' })
    public shakeAngle = 6;

    @property({ min: 0.01, tooltip: 'Thời gian 1 lần rung (giây).' })
    public shakeDuration = 0.4;

    @property({ min: 0, tooltip: 'Nghỉ (giây) giữa 2 lần rung.' })
    public shakeInterval = 0.8;

    @property({ tooltip: 'Độ cao hộp nảy lên khi bấm (local).' })
    public bounceHeight = 60;

    @property({ type: Enum(FxType), tooltip: 'Sound khi bấm hộp.' })
    public clickFxType: FxType = FxType.Click;

    @property({ type: Enum(FxType), tooltip: 'Sound khi hộp bật mở.' })
    public openFxType: FxType = FxType.Blink;

    @property({ tooltip: 'Bắn hiệu ứng sao khi hộp mở.' })
    public playOpenVfx = true;

    @property({ min: 0.01, tooltip: 'Thời gian mỗi item bay ra (giây).' })
    public itemFlyDuration = 0.55;

    @property({ tooltip: 'Độ cao cung nhảy của item (local).' })
    public itemJumpHeight = 220;

    @property({ min: 0, tooltip: 'Độ trễ (giây) giữa 2 item nhảy ra liên tiếp.' })
    public itemStagger = 0.02;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi item cuối nhảy ra rồi hộp mới biến mất.' })
    public hideDelay = 0.25;

    @property({ min: 0, tooltip: 'Sau bao lâu (giây) không bấm thì hiện tay gợi ý bấm hộp. 0 = không gợi ý.' })
    public handHintDelay = 3;

    @property({ type: Node, tooltip: 'Node tay gợi ý. Để trống: HandTutManager.Ins.handNode.' })
    public handNode: Node | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi bấm mở hộp.' })
    public onOpened: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi toàn bộ item đã nhảy ra và đáp xuống.' })
    public onAllItemsLanded: Ply_Event = new Ply_Event();

    private _appeared = false;
    private _ready = false;
    private _opened = false;
    private readonly _restPos = new Vec3();
    private readonly _restScale = new Vec3(1, 1, 1);
    private _restAngle = 0;
    private _handBaseScale: Vec3 | null = null;
    private readonly _onAllCleaned = () => this.Appear();

    public resetInEditor(): void {
        if (!this.onOpened) this.onOpened = new Ply_Event();
        if (!this.onAllItemsLanded) this.onAllItemsLanded = new Ply_Event();
    }

    protected onLoad(): void {
        const box = this.box;
        if (!box) return;
        this._restPos.set(box.position);
        this._restScale.set(box.scale);
        this._restAngle = box.angle;
        box.active = false;
        if (this.closedNode) this.closedNode.active = true;
        if (this.openNode) this.openNode.active = false;
    }

    protected start(): void {
        // Bind ở start: ItemCleanManager.Ins đã được gán trong onLoad của nó.
        this.Manager?.onAllItemsCleaned.addListener(this._onAllCleaned);
        this.box?.on(Node.EventType.TOUCH_END, this.onBoxClick, this);
    }

    protected onDestroy(): void {
        this.Manager?.onAllItemsCleaned.removeListener(this._onAllCleaned);
        if (this.box?.isValid) this.box.off(Node.EventType.TOUCH_END, this.onBoxClick, this);
    }

    /** Hộp phi từ dưới lên vị trí đặt trên scene. */
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
                .to(0.1, { scale: new Vec3(s.x * 1.12, s.y * 0.88, s.z) }, { easing: 'quadOut' })
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

    private onBoxClick(): void {
        if (!this._ready || this._opened) return;
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) return;
        this.Open();
    }

    /** Bấm hộp: nhún, nảy lên, đổi sprite mở, item nhảy ra rồi hộp biến mất. */
    public Open(): void {
        const box = this.box;
        if (!box || this._opened) return;
        this._opened = true;
        this.stopShake();
        this.hideHandHint();
        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        (GameManager.Ins as any)?.ResetInactivityTimer?.(null);
        this.onOpened.invoke();

        const rest = this._restPos;
        const s = this._restScale;
        const at = (sx: number, sy: number) => new Vec3(s.x * sx, s.y * sy, s.z);
        Tween.stopAllByTarget(box);
        box.setPosition(rest);
        box.angle = this._restAngle;
        tween(box)
            .to(0.14, { scale: at(1.2, 0.78) }, { easing: 'quadOut' })
            .to(0.18, { scale: at(0.88, 1.2), position: new Vec3(rest.x, rest.y + this.bounceHeight, rest.z) }, { easing: 'quadOut' })
            .call(() => this.openLid())
            .to(0.16, { scale: s, position: rest }, { easing: 'quadIn' })
            .to(0.08, { scale: at(1.1, 0.9) }, { easing: 'quadOut' })
            .to(0.14, { scale: s }, { easing: 'backOut' })
            .start();
    }

    private openLid(): void {
        if (this.closedNode) this.closedNode.active = false;
        if (this.openNode) this.openNode.active = true;
        Ply_SoundManager.Ins?.PlayFx(this.openFxType);
        this.spawnOpenVfx();
        this.spawnItems();
    }

    private spawnItems(): void {
        const manager = this.spawnManager ?? ItemSpawnManager.Ins as ItemSpawnManager | null;
        const count = manager?.GetRemainingItemCount() ?? 0;
        if (!manager || count <= 0) {
            this.hideBox(0);
            return;
        }

        const from = (this.spawnPoint ?? this.box!).worldPosition.clone();
        // Item bay ra các vị trí rải đều trong vùng spawn, hạn chế đè nhau.
        manager.SpawnBatchFromSource(from, count, this.itemFlyDuration, this.itemJumpHeight, this.itemStagger,
            () => this.onItemsLanded(manager));
        this.hideBox(count * this.itemStagger + this.hideDelay);
    }

    private onItemsLanded(manager: ItemSpawnManager): void {
        this.onAllItemsLanded.invoke();
        const popup = this.tutorialPopup;
        if (!popup || popup.HasShown) {
            manager.TriggerImmediateHandTut();
            return;
        }
        // Tay gợi ý kéo item chỉ hiện sau khi người chơi thu Tutorial vào icon.
        const onMinimized = () => {
            popup.onMinimized.removeListener(onMinimized);
            manager.TriggerImmediateHandTut();
        };
        popup.onMinimized.addListener(onMinimized);
        this.scheduleOnce(() => popup.Show(), this.tutorialDelay);
    }

    private hideBox(delay: number): void {
        const box = this.box;
        if (!box) return;
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

    // ---------------- Tay gợi ý bấm hộp ----------------

    private scheduleHandHint(): void {
        if (this.handHintDelay <= 0) return;
        this.unschedule(this.showHandHint);
        this.scheduleOnce(this.showHandHint, this.handHintDelay);
    }

    private showHandHint = (): void => {
        const hand = this.Hand;
        const box = this.box;
        if (!hand || !box || this._opened) return;
        Tween.stopAllByTarget(hand);
        hand.active = true;
        if (hand.parent) hand.setSiblingIndex(hand.parent.children.length - 1);
        hand.setWorldPosition(box.worldPosition);
        this._handBaseScale ??= hand.scale.clone();
        const base = this._handBaseScale;
        hand.setScale(base);
        tween(hand)
            .to(0.3, { scale: new Vec3(base.x * 0.8, base.y * 0.8, base.z) }, { easing: 'sineOut' })
            .to(0.3, { scale: base }, { easing: 'sineIn' })
            .delay(0.3)
            .union()
            .repeatForever()
            .start();
    };

    private hideHandHint(): void {
        this.unschedule(this.showHandHint);
        const hand = this.Hand;
        if (!hand?.active) return;
        Tween.stopAllByTarget(hand);
        if (this._handBaseScale) hand.setScale(this._handBaseScale);
        hand.active = false;
    }

    private get Hand(): Node | null {
        return this.handNode ?? HandTutManager.Ins?.handNode ?? null;
    }

    private get Manager(): ItemCleanManager | null {
        return this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
    }
}
