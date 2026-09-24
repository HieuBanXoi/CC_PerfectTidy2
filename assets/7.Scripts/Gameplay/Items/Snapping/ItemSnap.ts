import { _decorator, Component, Node, Sprite, Tween, tween, Vec3, Enum, Animation, animation, SkeletalAnimation, EventTouch, UITransform, Quat, v3, Collider2D, Contact2DType, IPhysics2DContact, PolygonCollider2D, BoxCollider2D, CCInteger, math } from 'cc';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { GameManager } from '../../Systems/GameManager';
import { InputManager } from '../../../Core/Managers/InputManager';
import { World } from '../../../Core/Managers/World';
import { PoolType } from '../../../Core/Pooling/PoolMember';
import { ItemHolder } from './ItemHolder';
import { BlinkEffect } from '../../Effects/BlinkEffect';
import { MergeEffect } from '../../Effects/MergeEffect';
import { HeartEffect } from '../../Effects/HeartEffect';

const { ccclass, property } = _decorator;

export enum ItemState {
    Waiting = 0,
    OnDrag = 1,
    MoveToCorrectPos = 2,
    OnGoal = 3,
    Flying = 4,     // Đang bay từ hộp ra vùng spawn (chưa tương tác / chưa hiện hand được)
}
Enum(ItemState);

@ccclass('ItemSnap')
export class ItemSnap extends Component {

    @property({ type: Enum(FxType), tooltip: 'Sound effect played when successfully placed' })
    public fxTypeOnPlace: FxType = FxType.Complete;

    @property({ tooltip: 'Phát thêm sound Aha cùng lúc với fxTypeOnPlace khi item snap trúng holder' })
    public playAhaOnPlace: boolean = true;

    @property({ tooltip: 'Unique ID matching ItemHolder.id' })
    public id: number = 0;

    @property({ type: Enum(ItemState), tooltip: 'Current lifecycle state of the item' })
    public currentState: ItemState = ItemState.Waiting;

    @property(Node)
    public defaultShadow: Node | null = null;

    @property({ tooltip: 'Return to home slot/conveyor position on miss' })
    public returnToSlotOnMiss: boolean = false;

    @property({ tooltip: 'Hide target holder shadow when item is dropped successfully' })
    public hideShadowOnDrop: boolean = false;

    @property({ tooltip: 'Scale multiplier applied when item spawns' })
    public scaleOnSpawn: boolean = false;

    @property({ min: 0.1 })
    public spawnScaleMultiplier: number = 1.25;

    @property({ tooltip: 'Base design scale of this item in the editor' })
    public baseScale: Vec3 = new Vec3(1, 1, 1);

    @property({ type: [Node], tooltip: 'Danh sách các Node ItemSnap phải được đặt thành công (OnGoal) trước khi item này có thể snap' })
    public requiredItems: Node[] = [];

    @property(Node)
    public correctHolderTransform: Node | null = null;

    @property(Node)
    public shadowOnHolder: Node | null = null;

    @property({ tooltip: 'Hiện shadowOnHolder (bóng gợi ý ở holder đích) ngay khi bắt đầu kéo item' })
    public canShowShadowHint: boolean = true;

    @property
    public keepShadowVisibleWhenWaiting: boolean = false;

    @property(Node)
    public homeSlot: Node | null = null;

    @property
    public waitingPosition: Vec3 = new Vec3();

    @property(Sprite)
    public spriteRenderer: Sprite | null = null;

    @property({ type: Enum(PoolType) })
    public vfxPoolType: PoolType = PoolType.BlinkFX;

    @property({ tooltip: 'Spawn thêm hiệu ứng trái tim (HeartFX) khi item snap vào holder thành công' })
    public spawnHeartOnPlaced: boolean = false;

    @property({
        min: 0,
        visible: function (this: ItemSnap) { return this.spawnHeartOnPlaced; },
        tooltip: 'Hệ số scale của hiệu ứng trái tim'
    })
    public heartEffectScale: number = 1.0;

    @property({
        min: 0,
        visible: function (this: ItemSnap) { return this.spawnHeartOnPlaced; },
        tooltip: 'Chờ bao nhiêu giây sau khi snap xong mới spawn trái tim (0 = spawn ngay)'
    })
    public heartSpawnDelay: number = 0;

    @property({
        visible: function (this: ItemSnap) { return this.spawnHeartOnPlaced; },
        tooltip: 'Gắn trái tim làm con của item (bật = bay theo item, tắt = đứng yên tại chỗ snap)'
    })
    public attachHeartToItem: boolean = false;

    @property({ min: 1.0, tooltip: 'Scale multiplier applied to baseScale when dragged' })
    public dragScaleMultiplier: number = 1.2;

    @property({ min: 0.05 })
    public dragScaleDuration: number = 0.2;

    @property({ min: 0.05 })
    public snapDuration: number = 0.2;

    @property({ min: 0, tooltip: 'Độ cao vồng lên khi item nhảy vào holder lúc snap (0 = bay thẳng)' })
    public snapJumpHeight: number = 60;

    @property({
        range: [0, 1, 0.05], slide: true,
        tooltip: 'Nhảy được bao nhiêu % quãng đường thì setParent item vào holder luôn (0.5 = giữa đường, 1 = chỉ gắn khi tiếp đất). Giữ nguyên world transform nên item không bị giật'
    })
    public reparentAtJumpProgress: number = 1;

    @property({ tooltip: 'Scale local của item sau khi đặt lên holder: bật = baseScale (scale thiết kế của item), tắt = 1. Cú nhảy luôn tween thẳng tới giá trị này nên không bị giật ở cuối' })
    public keepBaseScaleOnPlaced: boolean = true;

    @property({ min: 0.05 })
    public snapRotateDuration: number = 0.5;

    @property({ min: 0.05 })
    public missReturnDuration: number = 0.2;

    @property
    public enableIdleBobbing: boolean = true;

    @property({ min: 0 })
    public idleBobbingDistance: number = 15;

    @property({ min: 0.1 })
    public idleBobbingDuration: number = 1.5;

    @property({ type: Ply_Event, tooltip: 'Triggered when drag begins' })
    public onStartDrag: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Triggered when placed on target successfully' })
    public onPlacedSuccess: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Triggered when drag fails and item returns/drops' })
    public onPlacedFail: Ply_Event = new Ply_Event();

    @property({ tooltip: 'Apply a random Z angle when this item enters waiting state after spawn' })
    public randomRotationOnSpawn: boolean = true;

    @property({ tooltip: 'Minimum random Z offset in degrees from original rotation' })
    public randomSpawnAngleMin: number = -30;

    @property({ tooltip: 'Maximum random Z offset in degrees from original rotation' })
    public randomSpawnAngleMax: number = 30;

    @property({ tooltip: 'Khi thả item ra mà không trúng holder: xoay sang một góc Z ngẫu nhiên mới (dùng chung dải randomSpawnAngleMin/Max) thay vì trả về góc gốc' })
    public randomRotationOnDrop: boolean = true;

    public originalParent: Node | null = null;
    private originalScale: Vec3 = new Vec3(1, 1, 1);
    private originalRotation: Vec3 = new Vec3(0, 0, 0);
    private originalSiblingIndex: number = 0;
    private touchOffset: Vec3 = new Vec3();

    private itemAnimation: Animation | null = null;
    private itemAnimController: animation.AnimationController | null = null;
    private itemSkelAnimation: SkeletalAnimation | null = null;
    private isBobbing: boolean = false;
    private hasCachedOriginals: boolean = false;
    public isSpawnInitialized: boolean = false;
    /**
     * Khoá kéo thả tạm thời: item vẫn hiện, vẫn Waiting nhưng không nhấc lên được.
     * ItemSpawnManager bật cờ này lúc spawn khi lockDragOnSpawn = true, và gỡ ra
     * trong EnableItemSnapDrag().
     */
    public isDragLocked: boolean = false;
    /** Set by ItemSpawnManager for pre-placed items: start() must not begin idle bobbing (a later miss-drop still bobs). */
    public skipIdleBobbingOnStart: boolean = false;

    protected onLoad(): void {
        // this.tf = this.node;
        if (!this.spriteRenderer) {
            this.spriteRenderer = this.getComponent(Sprite) || this.getComponentInChildren(Sprite);
        }
        this.cacheOriginalTransform();
        this.cacheAnimations();
        this.ensureUITransform();
    }

    protected start(): void {
        if (!this.hasCachedOriginals) {
            this.cacheOriginalTransform();
        }
        if (!this.isSpawnInitialized) {
            this.ApplySpawnScale();
            this.ApplyRandomSpawnRotation();
            this.currentState = ItemState.Waiting;
        }

        if (this.enableIdleBobbing && !this.skipIdleBobbingOnStart && this.currentState === ItemState.Waiting && this.node.activeInHierarchy) {
            this.StartIdleBobbing();
        }
        this.skipIdleBobbingOnStart = false;
    }

    /** Item có đang ở trạng thái nhấc lên kéo được không (InputManager dùng để lọc touch). */
    public get CanStartDrag(): boolean {
        return this.enabled && !this.isDragLocked && this.currentState === ItemState.Waiting;
    }

    public GetWaitingScale(): Vec3 {
        const base = this.baseScale.lengthSqr() > 0.0001 ? this.baseScale.clone() : new Vec3(1, 1, 1);
        if (this.scaleOnSpawn) {
            return base.multiplyScalar(this.spawnScaleMultiplier);
        }
        return base;
    }

    public ApplySpawnScale(): void {
        const scale = this.GetWaitingScale();
        this.node.setScale(scale);
    }

    /** Góc gốc cộng thêm một offset Z ngẫu nhiên trong dải randomSpawnAngleMin/Max. */
    public GetRandomEuler(): Vec3 {
        const min = Math.min(this.randomSpawnAngleMin, this.randomSpawnAngleMax);
        const max = Math.max(this.randomSpawnAngleMin, this.randomSpawnAngleMax);
        return new Vec3(
            this.originalRotation.x,
            this.originalRotation.y,
            this.originalRotation.z + math.randomRange(min, max)
        );
    }

    public ApplyRandomSpawnRotation(): void {
        if (!this.randomRotationOnSpawn) {
            this.node.setRotationFromEuler(this.originalRotation.x, this.originalRotation.y, this.originalRotation.z);
            return;
        }

        const euler = this.GetRandomEuler();
        this.node.setRotationFromEuler(euler.x, euler.y, euler.z);
    }

    private cacheOriginalTransform(): void {
        if (this.node.scale.lengthSqr() > 0.0001) {
            this.baseScale = this.node.scale.clone();
        }
        this.originalScale = this.GetWaitingScale();
        this.originalRotation = this.node.eulerAngles.clone();
        this.originalParent = this.node.parent;
        this.originalSiblingIndex = this.node.getSiblingIndex();
        this.waitingPosition = this.node.worldPosition.clone();
        this.hasCachedOriginals = true;
    }

    private cacheAnimations(): void {
        this.itemAnimation = this.getComponent(Animation) || this.getComponentInChildren(Animation);
        this.itemAnimController = this.getComponent(animation.AnimationController) || this.getComponentInChildren(animation.AnimationController);
        this.itemSkelAnimation = this.getComponent(SkeletalAnimation) || this.getComponentInChildren(SkeletalAnimation);
    }

    private ensureUITransform(): void {
        if (!this.getComponent(UITransform)) {
            const ut = this.addComponent(UITransform);
            ut.setContentSize(100, 100);
        }
    }

    public ChangeState(newState: ItemState): void {
        this.currentState = newState;
    }

    public DisableAnimatorOnSpawn(): void {
        if (this.itemAnimation) this.itemAnimation.enabled = false;
        if (this.itemAnimController) this.itemAnimController.enabled = false;
        if (this.itemSkelAnimation) this.itemSkelAnimation.enabled = false;
    }

    public EnableAnimatorWhenPlaced(): void {
        if (this.itemAnimation) this.itemAnimation.enabled = true;
        if (this.itemAnimController) this.itemAnimController.enabled = true;
        if (this.itemSkelAnimation) this.itemSkelAnimation.enabled = true;
    }

    /**
     * Thứ tự vẽ UI 2D đi theo siblingIndex. KHÔNG dùng UITransform.priority: API này đã deprecated
     * từ 3.1 và setter của nó còn bắt engine sort lại toàn bộ children của node cha ở cuối frame,
     * ghi đè luôn siblingIndex mình vừa đặt.
     */
    public SetSortingOrder(order: number): void {
        const parent = this.node.parent;
        if (!parent) return;
        const maxIndex = parent.children.length - 1;
        this.node.setSiblingIndex(math.clamp(order, 0, maxIndex));
    }

    public BringToFront(): void {
        if (GameManager.Ins) {
            GameManager.Ins.currentLayer++;
        }

        if (this.node.parent) {
            this.node.setSiblingIndex(this.node.parent.children.length - 1);
        }
    }

    public StartDrag(touchWorldPos?: Vec3): void {
        if (!this.CanStartDrag) return;

        Ply_SoundManager.Ins?.PlayFx(FxType.Click);
        this.StopIdleBobbing();
        Tween.stopAllByTarget(this.node);

        (GameManager.Ins as any)?.ResetInactivityTimer?.(this);

        // Lưu lại parent ban đầu trước khi chuyển sang draggingNode
        if (this.node.parent && (!InputManager.Ins?.draggingNode || this.node.parent !== InputManager.Ins.draggingNode)) {
            this.originalParent = this.node.parent;
        }

        // Elevate node to top or move to draggingNode
        if (InputManager.Ins && InputManager.Ins.draggingNode && InputManager.Ins.draggingNode.isValid && InputManager.Ins.draggingNode.activeInHierarchy) {
            const currentWorldPos = this.node.worldPosition.clone();
            const currentWorldScale = this.node.worldScale.clone();
            this.node.setParent(InputManager.Ins.draggingNode);
            this.node.setWorldPosition(currentWorldPos);
            this.node.setWorldScale(currentWorldScale);
            this.BringToFront();
        } else if (this.node.parent) {
            this.BringToFront();
        }

        this.ChangeState(ItemState.OnDrag);

        // Gợi ý vị trí đích: bật shadow ở holder trong lúc kéo
        // (miss -> ReturnOrDropOnMiss tắt lại, snap đúng -> giữ theo hideShadowOnDrop)
        if (this.canShowShadowHint && this.shadowOnHolder) {
            this.shadowOnHolder.active = true;
        }

        // Scale nhân trực tiếp theo baseScale
        const targetScale = this.baseScale.clone().multiplyScalar(this.dragScaleMultiplier);
        tween(this.node)
            .to(this.dragScaleDuration, { scale: targetScale }, { easing: 'backOut' })
            .start();

        // Khi bắt đầu drag, luôn xoay item về 0.
        this.TweenRotationTo(Vec3.ZERO, this.dragScaleDuration, 'sineOut');
        // Giữ nguyên góc 0 cho các trạng thái về sau (ví dụ: return khi miss).
        this.originalRotation.set(0, 0, 0);

        if (touchWorldPos) {
            this.touchOffset = new Vec3(
                this.node.worldPosition.x - touchWorldPos.x,
                this.node.worldPosition.y - touchWorldPos.y,
                0
            );
        } else {
            this.touchOffset.set(0, 0, 0);
        }

        this.onStartDrag.invoke();
    }

    public HandleTouchMove(event: EventTouch): void {
        if (this.currentState !== ItemState.OnDrag) return;

        const touchLoc = event.getUILocation();
        const targetPos = new Vec3(
            touchLoc.x + this.touchOffset.x,
            touchLoc.y + this.touchOffset.y,
            this.node.worldPosition.z
        );
        this.node.setWorldPosition(targetPos);
    }

    @property({ min: 0, tooltip: 'Extra snap distance threshold (in pixels) for easier snapping' })
    public snapDistanceThreshold: number = 80;

    public ReleaseItem(): void {
        if (this.currentState !== ItemState.OnDrag) return;

        if (InputManager.Ins) {
            InputManager.Ins.isDragging = false;
        }

        const matchedHolder = this.FindMatchingHolder();

        if (matchedHolder && this.CanPlaced() && matchedHolder.id === this.id) {
            this.PlaceOnHolder(matchedHolder);
        } else {
            this.ReturnOrDropOnMiss();
        }
    }

    private FindMatchingHolder(): ItemHolder | null {
        const myWorldPos = this.node.worldPosition;

        // Ưu tiên 1: Kiểm tra trực tiếp correctHolderTransform nếu đã được gán
        if (this.correctHolderTransform && this.correctHolderTransform.activeInHierarchy) {
            const explicitHolder = this.correctHolderTransform.getComponent(ItemHolder);
            if (explicitHolder && explicitHolder.id === this.id) {
                if (explicitHolder.IsPointInside(myWorldPos, this.snapDistanceThreshold)
                    || explicitHolder.GetDistanceTo(myWorldPos) <= this.snapDistanceThreshold) {
                    return explicitHolder;
                }
            }
        }

        // Ưu tiên 2: Quét tất cả các holder trong scene CÙNG ID (holder.id === this.id)
        const scene = this.node.scene;
        if (!scene) return null;

        const allHolders = scene.getComponentsInChildren(ItemHolder);
        let bestCandidate: ItemHolder | null = null;
        let minDistance = Infinity;

        for (let i = 0; i < allHolders.length; i++) {
            const holder = allHolders[i];
            if (!holder || !holder.node.activeInHierarchy) continue;

            // CHỈ XÉT HOLDER CÓ ID TRÙNG VỚI ITEM NÀY (Bảo đảm không bao giờ bắt nhầm holder khác đè lên)
            if (holder.id !== this.id) continue;

            const isInside = holder.IsPointInside(myWorldPos, this.snapDistanceThreshold);
            const dist = holder.GetDistanceTo(myWorldPos);

            if (isInside || dist <= this.snapDistanceThreshold) {
                if (dist < minDistance) {
                    minDistance = dist;
                    bestCandidate = holder;
                }
            }
        }

        return bestCandidate;
    }

    /** backOut giống easing backOut của Tween: vọt quá đích một chút rồi lùi về đúng 1 tại t = 1. */
    private static EaseBackOut(t: number): number {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const u = t - 1;
        return 1 + c3 * u * u * u + c1 * u * u;
    }

    private PlaceOnHolder(holder: ItemHolder): void {
        this.ChangeState(ItemState.MoveToCorrectPos);
        Tween.stopAllByTarget(this.node);

        (GameManager.Ins as any)?.OnItemPlaced?.(this);

        // Notify ItemSpawnManager to spawn next item
        const vacatedPos = this.homeSlot ? this.homeSlot.worldPosition : this.waitingPosition;
        const spawnMgr = (this.node.scene?.getComponentInChildren('ItemSpawnManager' as any) as any);
        if (spawnMgr && typeof spawnMgr.SpawnNextItemToVacatedTarget === 'function') {
            spawnMgr.SpawnNextItemToVacatedTarget(vacatedPos);
        }
        this.homeSlot = null;

        const targetParent = holder.attachSlot || holder.node;
        const targetPos = (holder.attachSlot ? holder.attachSlot.worldPosition : holder.node.worldPosition).clone();
        const targetEuler = (holder.attachSlot ? holder.attachSlot.eulerAngles : holder.node.eulerAngles).clone();

        // Nhảy vồng parabol vào holder cho sinh động
        const startWorld = this.node.worldPosition.clone();
        const endWorld = new Vec3(targetPos.x, targetPos.y, startWorld.z);
        const snapAnim = { t: 0 };
        const snapTemp = new Vec3();

        // Scale đích tính theo LOCAL của holder, còn cú nhảy thì nội suy theo WORLD scale.
        // Nhờ vậy lúc đổi parent giữa chừng (keepWorldTransform) kích thước hiển thị không đổi,
        // và khi tới đích local scale rơi đúng endLocalScale nên không cần set cứng lần cuối.
        const endLocalScale = this.keepBaseScaleOnPlaced ? this.baseScale.clone() : new Vec3(1, 1, 1);
        const startWorldScale = this.node.worldScale.clone();
        const parentWorldScale = targetParent.worldScale;
        const endWorldScale = new Vec3(
            parentWorldScale.x * endLocalScale.x,
            parentWorldScale.y * endLocalScale.y,
            parentWorldScale.z * endLocalScale.z,
        );
        const scaleTemp = new Vec3();

        // Ngưỡng % quãng đường để gắn item vào holder ngay giữa chừng (1 = chỉ gắn khi tiếp đất)
        const reparentAt = math.clamp01(this.reparentAtJumpProgress);
        let hasReparented = false;

        // Punch chạy trên LOCAL scale và còn kéo dài sau khi cú nhảy kết thúc, nên nó phải
        // giành quyền điều khiển scale: từ lúc punch bắt đầu, onUpdate thôi ghi world scale.
        const punchAt = spawnMgr?.enablePunchOnPlaced
            ? math.clamp01(spawnMgr.punchStartJumpProgress ?? 1)
            : 1;
        let hasPunched = false;
        const attachToHolder = () => {
            if (hasReparented) return;
            hasReparented = true;

            // Luôn giữ world transform: kích thước và vị trí hiển thị không đổi tại thời điểm đổi
            // parent, phần bay còn lại vẫn do onUpdate điều khiển bằng world position / world scale.
            this.node.setParent(targetParent, true);

            // Chèn vào vị trí sibling cụ thể nếu được cấu hình (ví dụ: nằm giữa Back và Front)
            if (holder.insertSiblingIndex >= 0) {
                const clampedIdx = Math.min(holder.insertSiblingIndex, targetParent.children.length - 1);
                this.node.setSiblingIndex(clampedIdx);
            }
        };

        tween(snapAnim)
            .to(this.snapDuration, { t: 1 }, {
                easing: 'cubicOut',
                onUpdate: () => {
                    if (!this.node || !this.node.isValid) return;
                    const t = snapAnim.t;

                    // Gắn vào holder ngay khi nhảy đủ % quãng đường
                    if (!hasReparented && reparentAt < 1 && t >= reparentAt) {
                        attachToHolder();
                    }

                    Vec3.lerp(snapTemp, startWorld, endWorld, t);
                    snapTemp.y += this.snapJumpHeight * Math.sin(math.clamp01(t) * Math.PI);
                    this.node.setWorldPosition(snapTemp);

                    if (!hasPunched) {
                        Vec3.lerp(scaleTemp, startWorldScale, endWorldScale, ItemSnap.EaseBackOut(t));
                        this.node.setWorldScale(scaleTemp);
                    }

                    // Gần chạm holder thì bắt đầu punch. Phải vào đúng parent trước vì punch
                    // tween theo local scale; setParent giữ world transform nên không thấy nhảy.
                    if (!hasPunched && punchAt < 1 && t >= punchAt) {
                        hasPunched = true;
                        attachToHolder();
                        this.node.setScale(endLocalScale);
                        spawnMgr.PunchItem(this);
                    }
                }
            })
            .call(() => {
                if (!this.node || !this.node.isValid) return;

                // Âm thanh đặt đồ phát đúng lúc item chạm holder
                this.PlaySoundOnPlace();

                // Gán Item vào targetParent (holder.attachSlot hoặc holder.node) nếu chưa gắn giữa chừng
                attachToHolder();
                this.node.setPosition(Vec3.ZERO);
                this.node.setRotationFromEuler(0, 0, 0);
                // Punch đang sở hữu scale thì để yên, nó tự tween về endLocalScale khi xong.
                if (!hasPunched) {
                    // Trùng đúng giá trị mà onUpdate vừa chạy tới nên không tạo cú nhảy scale nào.
                    this.node.setScale(endLocalScale);
                }

                this.SpawnVFX();
                this.SpawnHeartOnPlaced();
                this.EnableAnimatorWhenPlaced();

                // Punch item một phát khi snap đúng (bật/tắt trong ItemSpawnManager).
                // Bỏ qua nếu punch đã chạy từ giữa cú nhảy.
                if (!hasPunched && spawnMgr && typeof spawnMgr.PunchItem === 'function') {
                    spawnMgr.PunchItem(this);
                }

                if (this.shadowOnHolder && !this.hideShadowOnDrop) {
                    this.shadowOnHolder.active = true;
                } else if (this.shadowOnHolder) {
                    this.shadowOnHolder.active = false;
                }

                if (this.defaultShadow) {
                    this.defaultShadow.active = true;
                }

                (GameManager.Ins as any)?.RemoveItemFromTutorial?.(this);
                this.ChangeState(ItemState.OnGoal);

                // Item đã về đúng chỗ: tính 1 nước đi.
                GameManager.Ins?.MoveOne();

                // Tắt component và collider để không thể click/kéo được nữa
                this.enabled = false;
                const colliders = this.getComponents(Collider2D);
                for (const col of colliders) {
                    col.enabled = false;
                }

                this.onPlacedSuccess.invoke(holder.node);
            })
            .start();

        this.TweenRotationTo(targetEuler, this.snapRotateDuration, 'sineOut');
    }

    private ReturnOrDropOnMiss(): void {
        if (this.shadowOnHolder && !this.keepShadowVisibleWhenWaiting) {
            this.shadowOnHolder.active = false;
        }

        this.ChangeState(ItemState.Waiting);
        Tween.stopAllByTarget(this.node);

        // 1. Trả về đúng parent của item ngay khi thả
        this.RestoreOriginalParent();

        // 2. Đưa lên trên cùng tuyệt đối (cả priority và siblingIndex)
        this.BringToFront();

        // 3. Đảm bảo Local Z luôn là 0
        const p = this.node.position;
        this.node.setPosition(p.x, p.y, 0);

        // 4. Tween scale về ban đầu; góc xoay thì lệch sang một góc ngẫu nhiên mới mỗi lần thả
        const returnScale = this.GetWaitingScale();
        tween(this.node)
            .to(this.dragScaleDuration, { scale: returnScale }, { easing: 'backOut' })
            .start();

        const dropEuler = this.randomRotationOnDrop ? this.GetRandomEuler() : this.originalRotation;
        this.TweenRotationTo(dropEuler, this.dragScaleDuration, 'sineOut');

        if (this.returnToSlotOnMiss) {
            const returnTarget = this.homeSlot ? this.homeSlot.worldPosition : this.waitingPosition;
            tween(this.node)
                .to(this.missReturnDuration, { worldPosition: new Vec3(returnTarget.x, returnTarget.y, 0) }, { easing: 'cubicOut' })
                .call(() => {
                    if (this.homeSlot && this.node.parent !== this.homeSlot) {
                        this.node.setParent(this.homeSlot);
                        this.node.setPosition(Vec3.ZERO);
                    }
                    this.BringToFront();
                    this.StartIdleBobbing();
                    this.onPlacedFail.invoke();
                })
                .start();
        } else {
            // Drop in place: Cập nhật toạ độ chờ và nhấp nhô
            this.waitingPosition = this.node.worldPosition.clone();
            this.StartIdleBobbing();
            this.onPlacedFail.invoke();
        }
    }

    public RestoreOriginalParent(): void {
        const targetParent = this.homeSlot || this.originalParent;

        if (targetParent && targetParent.isValid && this.node.parent !== targetParent) {
            const worldPos = this.node.worldPosition.clone();
            const worldScale = this.node.worldScale.clone();
            this.node.setParent(targetParent);
            this.node.setWorldPosition(worldPos);
            this.node.setWorldScale(worldScale);
        }
    }

    public CanPlaced(): boolean {
        if (!this.requiredItems || this.requiredItems.length === 0) return true;

        for (let i = 0; i < this.requiredItems.length; i++) {
            const req = this.requiredItems[i];
            if (!req) continue;

            const snap = (req instanceof Node) ? req.getComponent(ItemSnap) : (req as any);
            if (snap && snap.currentState !== ItemState.OnGoal) {
                return false;
            }
        }
        return true;
    }

    public StartIdleBobbing(): void {
        if (!this.enableIdleBobbing || !this.node.isValid || this.currentState !== ItemState.Waiting) return;
        this.StopIdleBobbing();
        this.isBobbing = true;

        const startLocalPos = this.node.position.clone();
        const topPos = new Vec3(startLocalPos.x, startLocalPos.y + this.idleBobbingDistance, startLocalPos.z);

        tween(this.node)
            .to(this.idleBobbingDuration * 0.5, { position: topPos }, { easing: 'sineInOut' })
            .to(this.idleBobbingDuration * 0.5, { position: startLocalPos }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    public StopIdleBobbing(): void {
        if (this.isBobbing) {
            Tween.stopAllByTarget(this.node);
            this.isBobbing = false;
        }
    }

    public SpawnVFX(): void {
        const poolManager = World.instance?.poolManager;
        if (!poolManager) return;

        const spawnPos = this.node.worldPosition.clone();

        // 1. Try BlinkEffect
        const blinkEffect = poolManager.spawnType<BlinkEffect>(PoolType.BlinkFX, spawnPos);
        if (blinkEffect) {
            blinkEffect.DeSpawnByTime();
            return;
        }

        // 2. Try MergeEffect / VFX / StarVFX
        const effect = poolManager.spawnType<MergeEffect>(this.vfxPoolType, spawnPos);
        if (effect && typeof effect.DeSpawnByTime === 'function') {
            effect.DeSpawnByTime();
        }
    }

    /** Trái tim ăn mừng khi item về đúng holder. Bật/tắt bằng spawnHeartOnPlaced trên Inspector. */
    public SpawnHeartOnPlaced(): void {
        if (!this.spawnHeartOnPlaced) return;

        if (this.heartSpawnDelay > 0) {
            // Delay chạy trên một object rời: ngay sau khi snap xong component này bị disable
            // nên scheduleOnce của Component sẽ không bao giờ bắn.
            tween({}).delay(this.heartSpawnDelay).call(() => this.DoSpawnHeart()).start();
            return;
        }
        this.DoSpawnHeart();
    }

    private DoSpawnHeart(): void {
        if (!this.node || !this.node.isValid) return;

        const spawnPos = this.node.worldPosition.clone();
        const heartEffect = World.instance?.poolManager?.spawnType<HeartEffect>(PoolType.HeartFX, spawnPos);
        if (!heartEffect) return;

        if (this.attachHeartToItem) {
            heartEffect.node.setParent(this.node, true);
            heartEffect.node.setPosition(0, 0, 0);
            heartEffect.node.setWorldRotationFromEuler(0, 0, 0);
        }

        heartEffect.PlaySpawnWithScale(this.heartEffectScale);
    }

    public PlaySoundOnPlace(): void {
        Ply_SoundManager.Ins?.PlayFx(this.fxTypeOnPlace);
        if (this.playAhaOnPlace) {
            Ply_SoundManager.Ins?.PlayFx(FxType.Aha);
        }
    }

    /**
     * Tween xoay góc Node mượt mà bằng setRotationFromEuler trong onUpdate (khắc phục lỗi tween eulerAngles của Cocos Creator)
     */
    public TweenRotationTo(targetRotation: Vec3, duration: number = 0.15, easing: any = 'sineOut'): void {
        const startEuler = this.node.eulerAngles.clone();
        const targetEuler = targetRotation.clone();

        // Xử lý góc xoay ngắn nhất quanh trục Z để không bị quay vòng tròn 360
        let diffZ = (targetEuler.z - startEuler.z) % 360;
        if (diffZ > 180) diffZ -= 360;
        if (diffZ < -180) diffZ += 360;
        const endZ = startEuler.z + diffZ;

        const rotState = { t: 0 };
        tween(rotState)
            .to(duration, { t: 1 }, {
                easing: easing,
                onUpdate: () => {
                    const t = rotState.t;
                    const x = math.lerp(startEuler.x, targetEuler.x, t);
                    const y = math.lerp(startEuler.y, targetEuler.y, t);
                    const z = math.lerp(startEuler.z, endZ, t);
                    this.node.setRotationFromEuler(x, y, z);
                }
            })
            .call(() => {
                this.node.setRotationFromEuler(targetEuler.x, targetEuler.y, targetEuler.z);
            })
            .start();
    }
}
