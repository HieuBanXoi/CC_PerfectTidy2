import { _decorator, Node, Vec2, Vec3, Enum, Tween, tween, UITransform, math, director, Layers, Rect } from 'cc';
import { Ply_Singleton } from '../../Framework/Ply_Singleton';
import { Ply_Event } from '../../Framework/Ply_Event';
import { GameManager } from '../../Systems/GameManager';
import { HandTutManager } from '../../Systems/HandTutManager';
import { HandHintPlayer } from '../../Systems/HandHintPlayer';
import { HandHintRequest, HandHintSource, IdleHandHint } from '../../Systems/IdleHandHint';
import { ItemSnap, ItemState } from './ItemSnap';
import { SpawnAreaPlanner } from './SpawnAreaPlanner';

const { ccclass, property } = _decorator;

export enum AreaSpawnMode {
    Continuous = 0,             // Tự động spawn 1 item mới khi có 1 item được đặt thành công
    Manual = 1,                 // Chỉ spawn khi gọi SpawnNextItem() / SpawnBatchFromSource()... qua code
}
Enum(AreaSpawnMode);

/**
 * Quản lý hàng đợi item ItemSnap: spawn vào vùng, đếm số món đặt đúng, thắng -> StopGame / GotoStore,
 * và tay gợi ý kéo item về chỗ đúng.
 *
 * Độc lập:
 * - Không cần ItemCleanManager. Ai muốn spawn (StudyBox, SuitcaseOpenTransition, ItemBox...) gọi API Spawn*.
 * - ItemSnap không phụ thuộc manager: manager tự nghe ItemSnap.AddPlaceListener.
 * - Tay gợi ý: scene có IdleHandHint thì manager chỉ là 1 nguồn gợi ý (kéo item về chỗ đúng), IdleHandHint lo
 *   thời điểm hiện. Không có IdleHandHint thì tự hiện theo handTutDelay trên HandHintPlayer (node tay dùng chung).
 */
@ccclass('ItemSpawnManager')
export class ItemSpawnManager extends Ply_Singleton<ItemSpawnManager> implements HandHintSource {

    // ==================== ITEMS ====================

    @property({ type: [ItemSnap], tooltip: 'Danh sách các ItemSnap sẽ được spawn theo thứ tự' })
    public dynamicItems: ItemSnap[] = [];

    @property({ tooltip: 'Trộn ngẫu nhiên thứ tự dynamicItems khi vào game (thứ tự item được spawn ra)' })
    public shuffleItemsOnStart: boolean = false;

    @property({
        displayName: '▶ [CLICK TO] COLLECT ALL ITEM SNAPS IN SCENE',
        tooltip: 'Tích chọn để tự động quét toàn bộ Scene và nạp tất cả ItemSnap vào mảng dynamicItems'
    })
    public get collectAllItemsTrigger(): boolean { return false; }
    public set collectAllItemsTrigger(value: boolean) { if (value) this.CollectAllItemSnapInScene(); }

    @property({
        displayName: '▶ [CLICK TO] CLEAR DYNAMIC ITEMS',
        tooltip: 'Tích chọn để xóa toàn bộ danh sách dynamicItems'
    })
    public get clearItemsTrigger(): boolean { return false; }
    public set clearItemsTrigger(value: boolean) {
        if (!value) return;
        this.dynamicItems = [];
        console.log('🗑️ [ItemSpawnManager] Đã xóa sạch danh sách dynamicItems.');
    }

    // ==================== SPAWN ====================

    @property({ type: Node, tooltip: 'Node chứa item sau khi spawn. Để trống: spawnAreaNode' })
    public itemsContainer: Node | null = null;

    @property({ type: Enum(AreaSpawnMode), tooltip: 'Continuous: đặt đúng 1 món thì tự spawn món tiếp. Manual: chỉ spawn khi được gọi.' })
    public spawnMode: AreaSpawnMode = AreaSpawnMode.Continuous;

    @property({ tooltip: 'Tự động spawn item khi bắt đầu game. Bỏ tích nếu muốn kích hoạt mở từ ItemBox / StudyBox' })
    public autoSpawnOnStart: boolean = true;

    @property({ min: 1, tooltip: 'Số lượng item được spawn xuất hiện ban đầu (RevealInitialItems)' })
    public initialSpawnCount: number = 3;

    @property({ min: 0.1, tooltip: 'Thời gian hiệu ứng phóng to (scale up) khi item xuất hiện' })
    public revealDuration: number = 0.4;

    @property({ tooltip: 'Bật hiệu ứng nhấp nhô lơ lửng cho item khi ở trạng thái chờ trong vùng' })
    public enableIdleBobbing: boolean = true;

    @property({ tooltip: 'Hiện bóng mờ (shadowOnHolder) tại chỗ đặt đúng khi kéo item. Tắt: không item nào hiện bóng khi kéo' })
    public showShadowOnDrag: boolean = true;

    // ==================== SPAWN AREA ====================

    @property({ type: Node, tooltip: 'Node có UITransform xác định vùng giới hạn spawn item' })
    public spawnAreaNode: Node = null!;

    @property({ tooltip: 'Khoảng cách cách lề bên trong vùng spawn (tránh spawn sát mép viền)' })
    public spawnAreaPadding: Vec2 = new Vec2(30, 30);

    @property({ type: [Node], tooltip: 'Các vùng hình chữ nhật cần loại trừ khi random vị trí spawn item (chỉ tính node đang active)' })
    public cantSpawnAreas: Node[] = [];

    @property({ tooltip: 'Khi spawn nhiều item cùng lúc: rải thoáng ra, hạn chế item sát / đè lên nhau' })
    public spreadRevealedItems: boolean = true;

    @property({ min: 5, tooltip: 'Bước lưới (world) khi tìm chỗ rải item: nhỏ = rải mịn hơn nhưng tính lâu hơn' })
    public spreadGridStep: number = 30;

    @property({ min: 1, tooltip: 'Số lần thử tìm vị trí hợp lệ ngoài CantSpawnArea trước khi fallback' })
    public maxSpawnPositionAttempts: number = 40;

    @property({ tooltip: 'Đợt spawn đầu: không cho item nào rơi lên holder của item được hand tut gợi ý đầu tiên (tránh che mất chỗ đặt)' })
    public keepFirstHandTutHolderClear: boolean = true;

    @property({ min: 0, tooltip: 'Khoảng hở thêm (world) quanh holder đó mà item không được chạm vào' })
    public firstHandTutHolderClearMargin: number = 0;

    // ==================== HAND HINT ====================

    @property({ tooltip: 'Bật tay gợi ý kéo item về chỗ đúng (có IdleHandHint: hiện khi người chơi không tương tác; không có: sau khi spawn / thả trượt)' })
    public enableSpawnHandTut: boolean = true;

    @property({ type: Node, tooltip: 'Node tay. Để trống: dùng HandTutManager.Ins.handNode' })
    public handTutNode: Node | null = null;

    @property({ min: 0, tooltip: 'Không có IdleHandHint: delay trước khi hiện tay gợi ý (giây), tính từ lần spawn / thả trượt gần nhất' })
    public handTutDelay: number = 7;

    @property({ min: 0.01, tooltip: 'Thời gian tay di chuyển từ item tới holder' })
    public handTutMoveDuration: number = 1.2;

    @property({ min: 0, tooltip: 'Thời gian dừng giữa các vòng lặp tay gợi ý' })
    public handTutWaitAtEndDuration: number = 0.2;

    @property({ min: 0, tooltip: 'Thời gian tay mờ dần khi tới đích trước khi lặp lại (giây)' })
    public handTutFadeOutDuration: number = 0.3;

    // ==================== WIN & STORE ====================

    @property({
        min: 0,
        tooltip: 'Số lượng item drop trúng mục tiêu để thắng / dừng game (0 = phải đặt hết tất cả dynamicItems)'
    })
    public maxPlacedItemsToWin: number = 0;

    @property({ tooltip: 'Tự động gọi GameManager.StopGame (và GotoStore) khi đạt đủ số lượng drop trúng' })
    public autoStopAndGoToStoreOnLimit: boolean = true;

    @property({
        tooltip: 'Bật: StopGame rồi GotoStore luôn. Tắt: chỉ StopGame (chạm màn hình tiếp theo mới mở store)',
        visible(this: ItemSpawnManager) { return this.autoStopAndGoToStoreOnLimit; }
    })
    public goToStoreOnLimit: boolean = true;

    @property({ min: 0, tooltip: 'Thời gian trễ trước khi gọi StopGame / GotoStore (giây) để người chơi kịp nhìn thấy item khớp vị trí' })
    public storeRedirectDelay: number = 0.5;

    @property({ type: Ply_Event, tooltip: 'Sự kiện khi đạt đủ số lượng item drop trúng mục tiêu' })
    public onPlacementLimitReached: Ply_Event = new Ply_Event();

    // ==================== STATE ====================

    private currentItemIndex: number = 0;
    private reservedItemCount: number = 0;   // Item đã được đợt SpawnBatchFromSource nhận nhưng chưa bay ra (stagger)
    private placedItemCount: number = 0;
    private isReachedLimit: boolean = false;
    private hasShownInitialSpawnHandTut: boolean = false;
    private initialHandTutRetryCount: number = 0;
    private readonly handTutBoundItems = new Set<ItemSnap>();
    private readonly appearingItems = new Set<ItemSnap>();   // Item đang bay ra / đang scale lên: chưa gợi ý tay
    private readonly onAnyItemPlaced = () => this.SpawnNextItemToVacatedTarget();

    public get PlacedItemCount(): number { return this.placedItemCount; }
    public get IsReachedLimit(): boolean { return this.isReachedLimit; }

    // ==================== LIFECYCLE ====================

    protected onLoad(): void {
        super.onLoad();
        this.placedItemCount = 0;
        this.isReachedLimit = false;

        if (!this.handTutNode) this.handTutNode = HandTutManager.Ins?.handNode || null;
        if (this.handTutNode) this.handTutNode.active = false;

        if (this.shuffleItemsOnStart) this.shuffleItems();

        // Ẩn các item khi vào game để chờ được spawn tuần tự
        for (const item of this.dynamicItems) {
            if (!item?.node) continue;
            item.node.active = false;
            if (!this.showShadowOnDrag) item.canShowShadowHint = false;
        }
    }

    protected onEnable(): void {
        ItemSnap.AddPlaceListener(this.onAnyItemPlaced);
        IdleHandHint.Register(this, ItemSpawnManager.HINT_PRIORITY);
    }

    protected start(): void {
        if (this.autoSpawnOnStart) this.RevealInitialItems();
    }

    protected onDisable(): void {
        ItemSnap.RemovePlaceListener(this.onAnyItemPlaced);
        IdleHandHint.Unregister(this);
        this.cancelSpawnHandTut();
    }

    protected onDestroy(): void {
        this.cancelSpawnHandTut();
        super.onDestroy();
    }

    // ==================== QUERIES ====================

    /** Còn item chưa spawn. */
    public HasItems(): boolean {
        return this.currentItemIndex + this.reservedItemCount < this.dynamicItems.length;
    }

    /** Số item chưa spawn và chưa bị đợt SpawnBatchFromSource nào giữ chỗ. */
    public GetRemainingItemCount(): number {
        return Math.max(0, this.dynamicItems.length - this.currentItemIndex - this.reservedItemCount);
    }

    /** Quét Scene, nạp tất cả ItemSnap (trừ node shadow _sd) vào dynamicItems. */
    public CollectAllItemSnapInScene(): void {
        const scene = director.getScene() || this.node.scene;
        if (!scene) {
            console.warn('⚠️ [ItemSpawnManager] Không tìm thấy Scene hiện tại.');
            return;
        }
        this.dynamicItems = scene.getComponentsInChildren(ItemSnap)
            .filter(snap => snap?.node && !snap.node.name.toLowerCase().endsWith('_sd'));
        this.dynamicItems.forEach(snap => snap.node.active = true);
        console.log(`✅ [ItemSpawnManager] Đã nạp ${this.dynamicItems.length} ItemSnap từ Scene vào dynamicItems!`);
    }

    // ==================== SPAWN API ====================

    /** Spawn initialSpawnCount item cùng lúc (scale up tại chỗ trong vùng spawn), rồi hiện tay gợi ý ngay. */
    public RevealInitialItems(): void {
        const countToSpawn = Math.min(this.initialSpawnCount, this.GetRemainingItemCount());
        if (countToSpawn <= 0) return;

        const isFirstReveal = !this.hasShownInitialSpawnHandTut;
        const spawnedItems: ItemSnap[] = [];
        let revealedCount = 0;

        const onRevealed = () => {
            // Lần spawn đầu tiên: hiển thị hand ngay khi item cuối hiện xong, không delay.
            if (++revealedCount >= spawnedItems.length && !this.hasShownInitialSpawnHandTut) {
                this.scheduleSpawnHandTut(true);
                this.hasShownInitialSpawnHandTut = true;
            }
        };
        for (let i = 0; i < countToSpawn; i++) {
            const spawned = this.SpawnNextItem(onRevealed, false);
            if (spawned) spawnedItems.push(spawned);
        }

        // Hand tut đầu gợi ý item nằm trên cùng = item spawn cuối của đợt này (BringToFront khi spawn).
        const tutHolder = this.getFirstHintHolder(spawnedItems, isFirstReveal);
        const clearRect = SpawnAreaPlanner.GetExpandedRect(tutHolder, this.firstHandTutHolderClearMargin);
        if (this.spreadRevealedItems && spawnedItems.length > 1) {
            const targets = this.Planner.PlanSpreadWorldPositions(spawnedItems, clearRect);
            spawnedItems.forEach((item, i) => {
                item.node.setWorldPosition(targets[i]);
                item.waitingPosition = targets[i].clone();
            });
        }
        if (clearRect) this.Planner.MoveItemsOffRect(spawnedItems, clearRect);

        if (spawnedItems.length <= 0 && !this.hasShownInitialSpawnHandTut) {
            this.scheduleSpawnHandTut(true);
            this.hasShownInitialSpawnHandTut = true;
        }
    }

    /** Spawn item tiếp theo: hiện tại 1 vị trí ngẫu nhiên trong vùng spawn, scale từ 0 lên. */
    public SpawnNextItem(onComplete?: (spawnedItem: ItemSnap) => void, shouldScheduleHandTut: boolean = true): ItemSnap | null {
        const item = this.takeNextItem();
        if (!item) return null;

        this.prepareForSpawn(item);
        item.node.setPosition(this.Planner.GetRandomLocalPosition());
        item.ApplyRandomSpawnRotation();
        item.waitingPosition = item.node.worldPosition.clone();
        this.showItem(item);
        item.ChangeState(ItemState.Waiting);

        tween(item.node)
            .to(this.revealDuration, { scale: item.GetWaitingScale() }, { easing: 'backOut' })
            .call(() => this.onItemSpawned(item, shouldScheduleHandTut, onComplete))
            .start();
        return item;
    }

    /**
     * Spawn item tiếp theo bay ra từ sourceWorldPos (ví dụ vị trí hộp): scale từ 0, nhảy parabol tới
     * targetWorldPos (null = ngẫu nhiên trong vùng spawn).
     */
    public SpawnNextItemFromSource(
        sourceWorldPos: Vec3,
        itemIndexInBatch: number = 0,
        totalInBatch: number = 1,
        flyDuration: number = 0.55,
        jumpHeight: number = 120,
        onComplete?: (spawnedItem: ItemSnap) => void,
        shouldScheduleHandTut: boolean = false,
        targetWorldPos: Vec3 | null = null,
        keepCurrentRotation: boolean = false
    ): ItemSnap | null {
        const item = this.takeNextItem();
        if (!item) return null;

        const container = this.prepareForSpawn(item);
        const containerUT = container.getComponent(UITransform) || container.addComponent(UITransform);
        const startLocal = containerUT.convertToNodeSpaceAR(sourceWorldPos);
        const targetLocal = containerUT.convertToNodeSpaceAR(targetWorldPos ?? this.Planner.GetRandomWorldPosition());
        const itemNode = item.node;

        itemNode.setPosition(startLocal);
        // Góc xoay chốt ngay từ lúc xuất phát và giữ nguyên suốt quá trình bay.
        if (!keepCurrentRotation) item.ApplyRandomSpawnRotation();
        this.showItem(item);

        const targetScale = item.GetWaitingScale();
        const arcHeight = jumpHeight + (itemIndexInBatch % 2 === 0 ? 15 : -15);

        tween(itemNode)
            .to(flyDuration, { scale: targetScale }, { easing: 'backOut' })
            .start();

        const anim = { t: 0 };
        const pos = new Vec3();
        tween(anim)
            .to(flyDuration, { t: 1 }, {
                easing: 'linear',
                onUpdate: () => {
                    const t = anim.t;
                    pos.set(
                        startLocal.x + (targetLocal.x - startLocal.x) * t,
                        startLocal.y + (targetLocal.y - startLocal.y) * t + arcHeight * Math.sin(t * Math.PI),
                        0,
                    );
                    itemNode.setPosition(pos);
                }
            })
            .call(() => {
                itemNode.setPosition(targetLocal);
                itemNode.setScale(targetScale);
                item.waitingPosition = itemNode.worldPosition.clone();
                item.ChangeState(ItemState.Waiting);
                this.onItemSpawned(item, shouldScheduleHandTut, onComplete);
            })
            .start();
        return item;
    }

    /**
     * Spawn count item bay ra từ sourceWorldPos, rải đều trong vùng spawn (hạn chế đè nhau),
     * mỗi item cách nhau stagger giây. onAllLanded gọi khi tất cả đã đáp. Trả về số item sẽ spawn.
     */
    public SpawnBatchFromSource(
        sourceWorldPos: Vec3,
        count: number,
        flyDuration: number = 0.55,
        jumpHeight: number = 120,
        stagger: number = 0,
        onAllLanded?: () => void
    ): number {
        if (this.isReachedLimit) return 0;
        // Bỏ qua các item đợt trước đã giữ chỗ (bấm hộp liên tục: nhiều đợt chồng nhau).
        const start = this.currentItemIndex + this.reservedItemCount;
        const batch = this.dynamicItems.slice(start, start + Math.max(0, count));
        const total = batch.length;
        if (total <= 0) return 0;
        this.reservedItemCount += total;

        // Chốt góc xoay trước để tính chỗ chiếm theo đúng góc lúc item đáp xuống.
        const valid = batch.filter(item => !!item?.node);
        valid.forEach(item => {
            item.isSpawnInitialized = true;
            item.ApplyRandomSpawnRotation();
        });
        const tutHolder = this.getFirstHintHolder(valid, !this.hasShownInitialSpawnHandTut);
        const positions = this.Planner.PlanSpreadWorldPositions(valid,
            SpawnAreaPlanner.GetExpandedRect(tutHolder, this.firstHandTutHolderClearMargin));
        const targets = new Map<ItemSnap, Vec3>();
        valid.forEach((item, i) => targets.set(item, positions[i]));

        let landed = 0;
        const onLanded = () => {
            if (++landed >= total) onAllLanded?.();
        };
        for (let i = 0; i < total; i++) {
            this.scheduleOnce(() => {
                this.reservedItemCount = Math.max(0, this.reservedItemCount - 1);
                const next = this.dynamicItems[this.currentItemIndex];
                const target = next ? targets.get(next) ?? null : null;
                const spawned = this.SpawnNextItemFromSource(sourceWorldPos, i, total, flyDuration, jumpHeight,
                    onLanded, false, target, !!target);
                // Item null / đã đạt giới hạn vẫn tính là xong để không kẹt.
                if (!spawned) onLanded();
            }, i * stagger);
        }
        return total;
    }

    // ==================== PLACEMENT & WIN ====================

    /** Gọi khi có 1 item đặt đúng: đếm, và ở chế độ Continuous thì spawn món tiếp theo. */
    public SpawnNextItemToVacatedTarget(_targetPosition?: Vec3, onComplete?: () => void): void {
        this.OnItemPlacedSuccessfully();

        if (!this.isReachedLimit && this.spawnMode === AreaSpawnMode.Continuous && this.HasItems()) {
            this.SpawnNextItem(() => onComplete?.());
            return;
        }
        onComplete?.();
    }

    /** Ghi nhận 1 item đặt đúng; đủ số lượng thì kết thúc. */
    public OnItemPlacedSuccessfully(_item?: ItemSnap): void {
        if (this.isReachedLimit) return;

        this.placedItemCount++;
        const targetLimit = this.maxPlacedItemsToWin > 0 ? this.maxPlacedItemsToWin : this.dynamicItems.length;
        console.log(`[ItemSpawnManager] Đã đặt đúng: ${this.placedItemCount}/${targetLimit} item`);

        if (this.placedItemCount >= targetLimit) {
            this.isReachedLimit = true;
            this.cancelSpawnHandTut();
            this.onReachedPlacementLimit();
        }
    }

    private onReachedPlacementLimit(): void {
        this.onPlacementLimitReached.invoke();

        this.scheduleOnce(() => {
            if (!this.autoStopAndGoToStoreOnLimit || !GameManager.Ins) return;
            console.log(`🎉 [ItemSpawnManager] Đạt mốc hoàn thành! Gọi StopGame${this.goToStoreOnLimit ? ' & GotoStore' : ''}...`);
            GameManager.Ins.StopGame();
            if (this.goToStoreOnLimit) GameManager.Ins.GotoStore();
        }, this.storeRedirectDelay);
    }

    // ==================== SPAWN POSITIONS ====================

    /** Vị trí world rải đều cho items trong vùng spawn (xem SpawnAreaPlanner). */
    public PlanSpreadWorldPositions(items: ItemSnap[], avoidRect: Rect | null = null): Vec3[] {
        return this.Planner.PlanSpreadWorldPositions(items, avoidRect);
    }

    /** Toạ độ local (trong spawnAreaNode) ngẫu nhiên ngoài các CantSpawnArea. */
    public GetRandomLocalPositionInArea(): Vec3 {
        return this.Planner.GetRandomLocalPosition();
    }

    /** Toạ độ local (trong spawnAreaNode) chia đều theo trục X cho item thứ index / totalCount. */
    public GetDistributedTargetPositionInArea(index: number, totalCount: number): Vec3 {
        return this.Planner.GetDistributedLocalPosition(index, totalCount);
    }

    private get Planner(): SpawnAreaPlanner {
        return new SpawnAreaPlanner({
            area: this.spawnAreaNode || this.node,
            container: this.Container,
            padding: this.spawnAreaPadding,
            blockAreas: this.cantSpawnAreas,
            gridStep: this.spreadGridStep,
            maxAttempts: this.maxSpawnPositionAttempts,
        });
    }

    // ==================== SPAWN HELPERS ====================

    private get Container(): Node {
        return this.itemsContainer || this.spawnAreaNode || this.node;
    }

    /** Lấy item kế tiếp trong hàng đợi (null nếu hết / đã thắng / slot rỗng). */
    private takeNextItem(): ItemSnap | null {
        if (this.isReachedLimit || this.currentItemIndex >= this.dynamicItems.length) return null;
        const item = this.dynamicItems[this.currentItemIndex++];
        return item?.node ? item : null;
    }

    /** Đưa item vào container (đúng layer UI), reset trạng thái để chuẩn bị xuất hiện. Trả về container. */
    private prepareForSpawn(item: ItemSnap): Node {
        const container = this.Container;
        const itemNode = item.node;

        // Đảm bảo cùng layer với container để Camera UI nhìn thấy
        const layer = container.layer || Layers.Enum.UI_2D;
        itemNode.layer = layer;
        for (const child of itemNode.children) child.layer = layer;

        if (itemNode.parent !== container) itemNode.setParent(container);
        item.originalParent = container;
        item.homeSlot = null;

        Tween.stopAllByTarget(itemNode);
        itemNode.setScale(Vec3.ZERO);
        item.DisableAnimatorOnSpawn();
        item.isSpawnInitialized = true;
        this.appearingItems.add(item);
        this.bindItemHandTutEvents(item);
        return container;
    }

    /** Bật item lên trên cùng, cho phép tương tác. */
    private showItem(item: ItemSnap): void {
        item.BringToFront();
        item.node.active = true;
        item.enabled = true;
    }

    private onItemSpawned(item: ItemSnap, shouldScheduleHandTut: boolean, onComplete?: (item: ItemSnap) => void): void {
        this.appearingItems.delete(item);
        if (this.enableIdleBobbing) item.StartIdleBobbing();
        if (shouldScheduleHandTut) this.scheduleSpawnHandTut();
        onComplete?.(item);
    }

    /** Holder của item mà tay gợi ý chỉ tới đầu tiên (item spawn cuối = nằm trên cùng), chỉ ở đợt đầu. */
    private getFirstHintHolder(items: readonly ItemSnap[], isFirstReveal: boolean): Node | null {
        if (!this.keepFirstHandTutHolderClear || !isFirstReveal || items.length === 0) return null;
        return items[items.length - 1].correctHolderTransform;
    }

    private shuffleItems(): void {
        const items = this.dynamicItems;
        for (let i = items.length - 1; i > 0; i--) {
            const j = math.randomRangeInt(0, i + 1);
            [items[i], items[j]] = [items[j], items[i]];
        }
    }

    // ==================== HAND HINT ====================

    /** Thứ tự ưu tiên trong IdleHandHint: kéo item đặt được luôn gợi ý trước (cánh tủ, hộp sau). */
    public static readonly HINT_PRIORITY = 0;

    /** HandHintSource: kéo item đang chờ, đặt được ngay, nằm trên cùng về chỗ đúng. */
    public GetHandHint(): HandHintRequest | null {
        if (!this.enableSpawnHandTut || this.isReachedLimit) return null;
        const item = this.getTopPriorityWaitingItem();
        if (!item) return null;
        return {
            kind: 'move',
            getStart: () => item.node.worldPosition,
            getEnd: () => (item.correctHolderTransform?.activeInHierarchy ? item.correctHolderTransform : item.node).worldPosition,
            canContinue: () => this.canContinueHandTut(item) && item.CanPlaced(),
        };
    }

    /** Item vừa xuất hiện: không có IdleHandHint thì hiện tay ngay; có thì IdleHandHint đếm lại idleDelay. */
    public TriggerImmediateHandTut(): void {
        this.scheduleSpawnHandTut(true);
    }

    private bindItemHandTutEvents(item: ItemSnap): void {
        if (this.handTutBoundItems.has(item)) return;
        this.handTutBoundItems.add(item);
        item.onStartDrag.addListener(() => this.cancelSpawnHandTut());
        item.onPlacedSuccess.addListener(() => this.cancelSpawnHandTut());
        item.onPlacedFail.addListener(() => this.scheduleSpawnHandTut());
    }

    private scheduleSpawnHandTut(noDelay: boolean = false): void {
        if (!this.enableSpawnHandTut || !this.isValid) return;

        // Có IdleHandHint: nó lo thời điểm hiện. Item vừa xuất hiện -> đếm lại từ đầu, không tương tác idleDelay giây mới hiện.
        const idle = IdleHandHint.Ins;
        if (idle?.isValid && idle.enabledInHierarchy) {
            if (noDelay) idle.RestartCountdown();
            return;
        }

        this.unschedule(this.showSpawnHandTut);
        this.HandPlayer?.Stop(this);

        if (noDelay) {
            this.initialHandTutRetryCount = 0;
            this.showSpawnHandTut();
            return;
        }
        this.scheduleOnce(this.showSpawnHandTut, this.handTutDelay);
    }

    private showSpawnHandTut = (): void => {
        if (!this.enableSpawnHandTut || !this.node.activeInHierarchy) return;

        // Gọi sớm (hand node chưa sẵn sàng / item chưa hiện) thì retry ngắn để hand đầu tiên vẫn hiện.
        if (!this.tryShowSpawnHandTut() && !this.hasShownInitialSpawnHandTut && this.initialHandTutRetryCount < 20) {
            this.initialHandTutRetryCount++;
            this.scheduleOnce(this.showSpawnHandTut, 0.2);
        }
    };

    private tryShowSpawnHandTut(): boolean {
        const player = this.HandPlayer;
        const hint = this.GetHandHint();
        if (!player || hint?.kind !== 'move') return false;

        // Đồng bộ với HandTutManager: tắt gợi ý của nó (nếu đang hiện) trước khi dùng tay.
        HandTutManager.Ins?.ResetHandTutDelay();
        player.PlayMove(this, hint.getStart, hint.getEnd, {
            moveDuration: this.handTutMoveDuration,
            fadeOutDuration: this.handTutFadeOutDuration,
            waitAtEndDuration: this.handTutWaitAtEndDuration,
        }, hint.canContinue);
        return true;
    }

    /** Item đang chờ, đặt được ngay, nằm trên cùng (priority / sibling cao nhất). */
    private getTopPriorityWaitingItem(): ItemSnap | null {
        const candidates = this.dynamicItems.filter(item => this.canContinueHandTut(item) && item.CanPlaced());
        if (candidates.length === 0) return null;

        const priorityOf = (item: ItemSnap) => item.getComponent(UITransform)?.priority ?? 0;
        candidates.sort((a, b) => (priorityOf(b) - priorityOf(a)) || (b.node.getSiblingIndex() - a.node.getSiblingIndex()));
        return candidates[0];
    }

    private canContinueHandTut(item: ItemSnap | null): boolean {
        return !!item?.node
            && !this.appearingItems.has(item)
            && item.node.activeInHierarchy
            && item.enabled
            && item.currentState === ItemState.Waiting
            && !this.isReachedLimit;
    }

    private cancelSpawnHandTut(): void {
        this.unschedule(this.showSpawnHandTut);
        this.HandPlayer?.Stop(this);
    }

    private get HandPlayer(): HandHintPlayer | null {
        return HandHintPlayer.For(this.handTutNode || HandTutManager.Ins?.handNode);
    }
}
