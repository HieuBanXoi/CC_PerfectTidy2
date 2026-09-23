import { _decorator, Component, Node, Vec2, Vec3, Enum, Tween, tween, UITransform, math, director, Layers } from 'cc';
import { Ply_Singleton } from '../../Framework/Ply_Singleton';
import { ItemSnap, ItemState } from './ItemSnap';
import { GameManager } from '../../Systems/GameManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { HandTutManager } from '../../Systems/HandTutManager';

const { ccclass, property } = _decorator;

export enum AreaSpawnMode {
    Continuous = 0,             // Tự động spawn 1 item mới khi có 1 item được đặt thành công
    Manual = 1,                 // Chỉ spawn khi gọi SpawnNextItem() qua code
}
Enum(AreaSpawnMode);

export enum InitialSpawnMode {
    Animated = 0,               // Đợt đầu spawn như bình thường (bay từ hộp / scale up tại vị trí random)
    PreplacedNoBobbing = 1,     // Đợt đầu hiện sẵn tại vị trí đặt trong editor, không nhấp nhô; kéo thả thì như bình thường
}
Enum(InitialSpawnMode);

@ccclass('ItemSpawnManager')
export class ItemSpawnManager extends Ply_Singleton<ItemSpawnManager> {

    @property({
        type: Node,
        tooltip: 'Node có UITransform xác định vùng giới hạn spawn item'
    })
    public spawnAreaNode: Node = null!;

    @property({
        type: [ItemSnap],
        tooltip: 'Danh sách các ItemSnap sẽ được spawn theo thứ tự'
    })
    public dynamicItems: ItemSnap[] = [];

    // ==================== EDITOR ACTION BUTTONS ====================

    @property({
        displayName: '▶ [CLICK TO] COLLECT ALL ITEM SNAPS IN SCENE',
        tooltip: 'Tích chọn để tự động quét toàn bộ Scene và nạp tất cả ItemSnap vào mảng dynamicItems'
    })
    public get collectAllItemsTrigger(): boolean {
        return false;
    }
    public set collectAllItemsTrigger(value: boolean) {
        if (value) {
            this.CollectAllItemSnapInScene();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] CLEAR DYNAMIC ITEMS',
        tooltip: 'Tích chọn để xóa toàn bộ danh sách dynamicItems'
    })
    public get clearItemsTrigger(): boolean {
        return false;
    }
    public set clearItemsTrigger(value: boolean) {
        if (value) {
            this.dynamicItems = [];
            console.log('🧹 [ItemSpawnManager] Đã làm trống danh sách dynamicItems.');
        }
    }

    // ===============================================================

    @property({
        type: Node,
        tooltip: 'Node cha chứa các item khi spawn (để trống sẽ tự động lấy spawnAreaNode)'
    })
    public itemsContainer: Node | null = null;

    @property({
        type: Enum(AreaSpawnMode),
        tooltip: 'Continuous: tự động spawn item tiếp theo khi 1 item được đặt đúng; Manual: spawn thủ công'
    })
    public spawnMode: AreaSpawnMode = AreaSpawnMode.Continuous;

    @property({ tooltip: 'Tự động spawn item khi bắt đầu game. Bỏ tích nếu muốn kích hoạt mở từ ItemBox' })
    public autoSpawnOnStart: boolean = true;

    @property({ tooltip: 'Item hiện ra ở trạng thái chưa kéo được. Gọi EnableItemSnapDrag() từ chỗ khác (event / script) để mở khoá' })
    public lockDragOnSpawn: boolean = false;

    @property({ min: 0, tooltip: 'Số item spawn ban đầu khi vào game / mỗi lần ItemBox click (nếu box không override). 0 = không spawn lúc start; ItemBox click sẽ spawn toàn bộ item còn lại' })
    public initialSpawnCount: number = 3;

    @property({
        type: Enum(InitialSpawnMode),
        tooltip: 'Animated: đợt initialSpawnCount spawn như bình thường. PreplacedNoBobbing: đợt đầu hiện sẵn đúng vị trí đặt trong editor, không có bob effect; khi kéo thả thì hoạt động như bình thường'
    })
    public initialSpawnMode: InitialSpawnMode = InitialSpawnMode.Animated;

    // ==================== SPAWN FROM SOURCE (BOX) ====================

    @property({
        type: Node,
        tooltip: 'Điểm xuất phát khi item bay ra (miệng hộp). ItemBox sẽ tự đăng ký node này lúc start; để trống nếu không dùng hộp'
    })
    public spawnSourceNode: Node | null = null;

    @property({ min: 0.1, tooltip: 'Thời gian item bay từ nguồn (hộp) tới vị trí đích (giây)' })
    public flyDuration: number = 0.55;

    @property({ tooltip: 'Độ cao vồng parabol khi item bay ra từ nguồn (hộp)' })
    public jumpHeight: number = 120;

    @property({ tooltip: 'Punch (nảy scale) item khi gần bay tới nơi cho sinh động' })
    public enableFlyPunch: boolean = true;

    @property({ range: [0.3, 0.95, 0.05], slide: true, tooltip: 'Thời điểm bắt đầu punch, tính theo % thời gian bay (0.7 = khi bay được 70% quãng đường)' })
    public flyPunchStartRatio: number = 0.7;

    @property({ min: 1, tooltip: 'Hệ số scale đỉnh của punch lúc bay tới nơi' })
    public flyPunchScale: number = 1.25;

    // ================================================================

    @property({ min: 0.1, tooltip: 'Thời gian hiệu ứng phóng to (scale up) khi item xuất hiện' })
    public revealDuration: number = 0.4;

    @property({ tooltip: 'Khoảng cách cách lề bên trong vùng spawn (tránh spawn sát mép viền)' })
    public spawnAreaPadding: Vec2 = new Vec2(30, 30);

    @property({ type: [Node], tooltip: 'Các vùng hình chữ nhật cần loại trừ khi random vị trí spawn item' })
    public cantSpawnAreas: Node[] = [];

    @property({ min: 1, tooltip: 'Số lần thử tìm vị trí hợp lệ ngoài CantSpawnArea trước khi fallback' })
    public maxSpawnPositionAttempts: number = 40;

    @property({ tooltip: 'Bật hiệu ứng nhấp nhô lơ lửng cho item khi ở trạng thái chờ trong vùng' })
    public enableIdleBobbing: boolean = true;

    // ==================== PUNCH KHI SNAP ĐÚNG ====================

    @property({ tooltip: 'Punch (nảy scale) item một phát ngay khi snap đúng vào holder' })
    public enablePunchOnPlaced: boolean = true;

    @property({ range: [0.5, 1, 0.05], slide: true, tooltip: 'Punch bắt đầu khi item nhảy được bao nhiêu % quãng đường vào holder (0.9 = gần chạm nơi). 1 = chỉ punch sau khi đã đáp hẳn xuống' })
    public punchStartJumpProgress: number = 0.9;

    @property({ min: 1, tooltip: 'Hệ số scale trục X ở đỉnh punch: item bè ngang ra' })
    public punchScaleX: number = 1.22;

    @property({ range: [0.5, 1, 0.01], slide: true, tooltip: 'Hệ số scale trục Y ở đỉnh punch: bẹt xuống một chút. Đây mới là thứ tạo cảm giác squash & stretch thay vì chỉ phình to đều' })
    public punchScaleY: number = 0.9;

    @property({ range: [0, 1, 0.05], slide: true, tooltip: 'Độ mạnh của nhịp dội ngược (vươn cao, thon lại) sau khi bè ngang. 0 = bỏ nhịp này, punch chỉ còn 2 thì' })
    public punchReboundRatio: number = 0.5;

    @property({ min: 0.05, tooltip: 'Tổng thời gian punch (giây)' })
    public punchDuration: number = 0.25;

    // =============================================================

    @property({ tooltip: 'Đăng ký item vừa spawn cho HandTutManager để nó gợi ý kéo. Node hand, delay và giới hạn số item nằm ở HandTutManager (mục ITEMSNAP HINT)' })
    public enableSpawnHandTut: boolean = true;

    // ==================== WIN & STORE REDIRECT LOGIC ====================

    @property({
        min: 0,
        tooltip: 'Số lượng item tối đa drop trúng mục tiêu để thắng / dừng game (0 = không giới hạn, phải đặt hết tất cả dynamicItems)'
    })
    public maxPlacedItemsToWin: number = 0;

    @property({
        tooltip: 'Tự động gọi GameManager.StopGame và GameManager.GotoStore khi đạt đủ số lượng drop trúng'
    })
    public autoStopAndGoToStoreOnLimit: boolean = true;

    @property({
        min: 0,
        tooltip: 'Thời gian trễ trước khi gọi GoToStore / StopGame (giây) để người chơi kịp nhìn thấy item khớp vị trí'
    })
    public storeRedirectDelay: number = 0.5;

    @property({
        type: Ply_Event,
        tooltip: 'Sự kiện khi đạt đủ số lượng item drop trúng mục tiêu'
    })
    public onPlacementLimitReached: Ply_Event = new Ply_Event();

    // ===================================================================

    private currentItemIndex: number = 0;
    private placedItemCount: number = 0;
    private isReachedLimit: boolean = false;
    private spawnAreaTransform: UITransform | null = null;
    private inFlightCount: number = 0;       // số item đang bay từ hộp, chưa tiếp đất

    public get PlacedItemCount(): number {
        return this.placedItemCount;
    }

    public get IsReachedLimit(): boolean {
        return this.isReachedLimit;
    }

    protected onLoad(): void {
        super.onLoad();

        this.placedItemCount = 0;
        this.isReachedLimit = false;

        if (this.spawnAreaNode) {
            this.spawnAreaTransform = this.spawnAreaNode.getComponent(UITransform);
            if (!this.spawnAreaTransform) {
                this.spawnAreaTransform = this.spawnAreaNode.addComponent(UITransform);
            }
        }

        // Hand tut của ItemSnap do HandTutManager chạy; nó chỉ cần biết khi nào được phép gợi ý.
        if (this.enableSpawnHandTut) {
            HandTutManager.Ins?.SetItemSnapHintCondition(() => this.inFlightCount === 0 && !this.isReachedLimit);
        }

        // Ẩn các dynamic item khi vào game để chờ được spawn tuần tự
        for (let i = 0; i < this.dynamicItems.length; i++) {
            const item = this.dynamicItems[i];
            if (item && item.node) {
                item.node.active = false;
            }
        }
    }

    protected start(): void {
        if (this.autoSpawnOnStart) {
            this.RevealInitialItems();
        }
    }

    protected onDestroy(): void {
        HandTutManager.Ins?.SetItemSnapHintCondition(null);
    }

    /**
     * Tự động tìm kiếm và nạp tất cả ItemSnap có trong Scene vào mảng dynamicItems.
     */
    public CollectAllItemSnapInScene(): void {
        const scene = director.getScene() || this.node.scene;
        if (!scene) {
            console.warn('⚠️ [ItemSpawnManager] Không tìm thấy Scene hiện tại.');
            return;
        }

        const allSnaps = scene.getComponentsInChildren(ItemSnap);
        const validSnaps: ItemSnap[] = [];

        for (let i = 0; i < allSnaps.length; i++) {
            const snap = allSnaps[i];
            if (snap && snap.node && !snap.node.name.toLowerCase().endsWith('_sd')) {
                snap.node.active = true;
                validSnaps.push(snap);
            }
        }

        this.dynamicItems = validSnaps;
        console.log(`✅ [ItemSpawnManager] Đã tìm thấy và nạp thành công ${validSnaps.length} ItemSnap từ Scene vào dynamicItems!`);
    }

    /**
     * Kiểm tra xem còn item nào trong danh sách dynamicItems chưa spawn không.
     */
    public HasItems(): boolean {
        return this.currentItemIndex < this.dynamicItems.length;
    }

    public GetRemainingItemCount(): number {
        return Math.max(0, this.dynamicItems.length - this.currentItemIndex);
    }

    // ==================== SPAWN SOURCE (BOX) ====================

    /**
     * Đăng ký / huỷ đăng ký điểm xuất phát của item (ItemBox gọi khi start / destroy).
     */
    public SetSpawnSource(sourceNode: Node | null): void {
        this.spawnSourceNode = sourceNode;
    }

    public HasSpawnSource(): boolean {
        return !!this.spawnSourceNode && this.spawnSourceNode.isValid && this.spawnSourceNode.activeInHierarchy;
    }

    /** Còn ItemSnap nào đang chờ được kéo trên màn hình không (ItemBox dùng để quyết định hand tut trỏ vào hộp). */
    public HasWaitingItemsOnScreen(): boolean {
        return this.getTopPriorityWaitingItem() !== null;
    }

    private getSpawnSourceWorldPos(): Vec3 | null {
        return this.HasSpawnSource() ? this.spawnSourceNode!.worldPosition.clone() : null;
    }

    // ==================== BATCH SPAWN ====================

    /**
     * Spawn đợt item ban đầu vào trong vùng spawn (dùng khi autoSpawnOnStart = true).
     */
    public RevealInitialItems(): void {
        if (this.initialSpawnCount > 0) {
            if (this.initialSpawnMode === InitialSpawnMode.PreplacedNoBobbing) {
                this.RevealPreplacedItems(this.initialSpawnCount);
            } else {
                this.SpawnBatch(this.initialSpawnCount);
            }
        } else {
            this.onBatchLanded();
        }
        (GameManager.Ins as any)?.TriggerTutorial?.();
    }

    /**
     * Hiện sẵn `count` item tiếp theo ngay tại vị trí / parent đã đặt trong editor:
     * không bay, không scale up, không nhấp nhô. Kéo thả sau đó hoạt động như item spawn bình thường.
     * @returns Số item thực tế đã hiện
     */
    public RevealPreplacedItems(count: number = 0): number {
        const remaining = this.GetRemainingItemCount();
        let countToReveal = count > 0 ? count : (this.initialSpawnCount > 0 ? this.initialSpawnCount : remaining);
        countToReveal = Math.min(countToReveal, remaining);

        let revealedCount = 0;
        for (let i = 0; i < countToReveal; i++) {
            if (this.revealNextItemPreplaced()) revealedCount++;
        }

        this.onBatchLanded();
        return revealedCount;
    }

    /**
     * Đồng bộ layer của item (và các node con) theo node cha chứa nó, mặc định UI_2D.
     * Camera UI chỉ vẽ layer nằm trong visibility mask của nó, node con để layer DEFAULT sẽ bị cull.
     */
    private applyContainerLayer(itemNode: Node, container: Node | null): void {
        const containerLayer = container?.layer || Layers.Enum.UI_2D;
        itemNode.layer = containerLayer;
        for (const child of itemNode.children) {
            child.layer = containerLayer;
        }
    }

    private revealNextItemPreplaced(): ItemSnap | null {
        if (this.isReachedLimit || this.currentItemIndex >= this.dynamicItems.length) {
            return null;
        }

        const item = this.dynamicItems[this.currentItemIndex];
        this.currentItemIndex++;

        if (!item || !item.node) {
            return null;
        }

        const itemNode = item.node;
        item.originalParent = itemNode.parent;
        item.homeSlot = null;

        Tween.stopAllByTarget(itemNode);
        item.isSpawnInitialized = true;

        // ItemSnap.start() would begin bobbing on activation; a pre-placed item stays still until dragged.
        item.skipIdleBobbingOnStart = true;

        // Phải bật node TRƯỚC: onLoad() của ItemSnap mới chạy và cache được scale/rotation đặt trong
        // editor. Nếu gọi Apply* lúc node còn tắt thì baseScale/originalRotation vẫn là giá trị mặc
        // định (1,1,1) / (0,0,0) và transform của item bị ghi sai.
        itemNode.active = true;
        item.enabled = true;
        item.isDragLocked = this.lockDragOnSpawn;

        item.ApplyRandomSpawnRotation();
        item.ApplySpawnScale();
        item.DisableAnimatorOnSpawn();

        // Node con (Model chứa Sprite) hay bị để layer DEFAULT nên UICam (visibility = UI_2D) cull mất
        // => item "biến mất" lúc play dù trong editor vẫn thấy. 2 luồng spawn kia đã chuẩn hoá layer,
        // luồng preplaced trước đây thì không.
        this.applyContainerLayer(itemNode, itemNode.parent);

        // KHÔNG gọi BringToFront ở chế độ preplaced: giữ nguyên thứ tự sibling đã đặt trong editor.

        item.waitingPosition = itemNode.worldPosition.clone();
        (GameManager.Ins as any)?.AddItemToTutorial?.(item);
        this.bindItemHandTutEvents(item);

        item.ChangeState(ItemState.Waiting);
        item.StopIdleBobbing();

        return item;
    }

    /**
     * Spawn đồng thời một đợt item (bay ra từ hộp nếu có spawnSourceNode, ngược lại hiện tại chỗ).
     * @param count Số item muốn spawn (<= 0 sẽ dùng initialSpawnCount; nếu initialSpawnCount cũng = 0 thì spawn toàn bộ item còn lại)
     * @param onAllLanded Gọi khi tất cả item trong đợt đã tiếp đất, kèm số item thực tế đã spawn
     * @returns Số item thực tế đã spawn
     */
    public SpawnBatch(count: number = 0, onAllLanded?: (spawnedCount: number) => void): number {
        const remaining = this.GetRemainingItemCount();
        let countToSpawn = count > 0 ? count : (this.initialSpawnCount > 0 ? this.initialSpawnCount : remaining);
        countToSpawn = Math.min(countToSpawn, remaining);

        if (countToSpawn <= 0 || this.isReachedLimit) {
            this.onBatchLanded();
            onAllLanded?.(0);
            return 0;
        }

        const sourceWorldPos = this.getSpawnSourceWorldPos();
        let spawnedCount = 0;
        let landedCount = 0;

        const onEachLanded = () => {
            landedCount++;
            if (landedCount >= spawnedCount) {
                this.onBatchLanded();
                onAllLanded?.(spawnedCount);
            }
        };

        for (let i = 0; i < countToSpawn; i++) {
            const item = sourceWorldPos
                ? this.SpawnNextItemFromSource(sourceWorldPos, i, countToSpawn, this.flyDuration, this.jumpHeight, onEachLanded, false)
                : this.spawnNextItemInPlace(onEachLanded, false);

            if (item) spawnedCount++;
        }

        if (spawnedCount <= 0) {
            this.onBatchLanded();
            onAllLanded?.(0);
        }

        return spawnedCount;
    }

    /**
     * Sau khi cả đợt tiếp đất: hiện hand tutorial ngay (không delay).
     * Nếu vẫn còn item của đợt khác đang bay (click liên tục) thì chờ đợt cuối tiếp đất.
     */
    private onBatchLanded(): void {
        if (this.inFlightCount > 0 || !this.enableSpawnHandTut) return;
        HandTutManager.Ins?.StartHandTutNoDelay();
    }

    /**
     * Mở khoá kéo thả cho toàn bộ ItemSnap. Gọi thủ công khi tới lúc cho người chơi
     * động vào item (ví dụ sau khi lau xong, sau một đoạn cutscene...).
     */
    public EnableItemSnapDrag(): void {
        this.SetItemSnapDragEnabled(true);
    }

    /** Khoá lại kéo thả cho toàn bộ ItemSnap. */
    public DisableItemSnapDrag(): void {
        this.SetItemSnapDragEnabled(false);
    }

    /**
     * Đặt trạng thái kéo thả cho mọi ItemSnap trong dynamicItems. Cập nhật luôn lockDragOnSpawn
     * để các item spawn sau đó đi theo trạng thái mới nhất thay vì quay lại giá trị đặt trong editor.
     */
    public SetItemSnapDragEnabled(canDrag: boolean): void {
        this.lockDragOnSpawn = !canDrag;

        for (const item of this.dynamicItems) {
            if (item?.isValid) item.isDragLocked = !canDrag;
        }

        // Hand tut lọc ứng viên bằng ItemSnap.CanStartDrag nên item đang khoá kéo sẽ không được
        // gợi ý. Đổi trạng thái xong thì nhắc HandTutManager tính lại từ đầu idle delay, thay vì
        // để nó chờ hết chu kỳ cũ mới nhận ra là đã có item chơi được.
        HandTutManager.Ins?.ResetHandTutDelay();
    }

    public get InFlightCount(): number {
        return this.inFlightCount;
    }

    /**
     * Spawn item tiếp theo từ danh sách dynamicItems.
     * Nếu có spawnSourceNode (hộp) thì item bay ra từ hộp, ngược lại hiện tại chỗ trong vùng spawn.
     */
    public SpawnNextItem(onComplete?: (spawnedItem: ItemSnap) => void, shouldScheduleHandTut: boolean = true): ItemSnap | null {
        const sourceWorldPos = this.getSpawnSourceWorldPos();
        if (sourceWorldPos) {
            return this.SpawnNextItemFromSource(sourceWorldPos, 0, 1, this.flyDuration, this.jumpHeight, onComplete, shouldScheduleHandTut);
        }
        return this.spawnNextItemInPlace(onComplete, shouldScheduleHandTut);
    }

    /**
     * Spawn item tiếp theo vào một toạ độ ngẫu nhiên trong vùng UITransform (scale up tại chỗ).
     */
    private spawnNextItemInPlace(onComplete?: (spawnedItem: ItemSnap) => void, shouldScheduleHandTut: boolean = true): ItemSnap | null {
        if (this.isReachedLimit || this.currentItemIndex >= this.dynamicItems.length) {
            return null;
        }

        const item = this.dynamicItems[this.currentItemIndex];
        this.currentItemIndex++;

        if (!item || !item.node) {
            return null;
        }

        const targetContainer = this.itemsContainer || this.spawnAreaNode || this.node;
        const itemNode = item.node;

        this.applyContainerLayer(itemNode, targetContainer);

        // Đặt parent
        if (itemNode.parent !== targetContainer) {
            itemNode.setParent(targetContainer);
        }
        item.originalParent = targetContainer;

        // Tính toạ độ local bên trong targetContainer
        const randomLocalPos = this.GetRandomLocalPositionInArea();
        item.homeSlot = null;

        Tween.stopAllByTarget(itemNode);
        itemNode.setPosition(randomLocalPos);
        item.isSpawnInitialized = true;
        item.ApplyRandomSpawnRotation();

        const targetScale = item.GetWaitingScale();
        itemNode.setScale(Vec3.ZERO);
        item.DisableAnimatorOnSpawn();

        item.waitingPosition = itemNode.worldPosition.clone();
        (GameManager.Ins as any)?.AddItemToTutorial?.(item);

        this.bindItemHandTutEvents(item);

        // Kích hoạt hiển thị và đưa lên trên cùng
        item.BringToFront();
        itemNode.active = true;
        item.enabled = true;
        item.isDragLocked = this.lockDragOnSpawn;
        item.ChangeState(ItemState.Waiting);

        tween(itemNode)
            .to(this.revealDuration, { scale: targetScale }, { easing: 'backOut' })
            .call(() => {
                if (this.enableIdleBobbing) {
                    item.StartIdleBobbing();
                }
                if (shouldScheduleHandTut) {
                    HandTutManager.Ins?.ResetHandTutDelay();
                }
                onComplete?.(item);
            })
            .start();

        return item;
    }

    /**
     * Spawn item từ toạ độ hộp (scale 0), jump theo quỹ đạo parabol và zoom dần về target scale.
     */
    public SpawnNextItemFromSource(
        sourceWorldPos: Vec3,
        itemIndexInBatch: number = 0,
        totalInBatch: number = 1,
        flyDuration: number = 0.55,
        jumpHeight: number = 120,
        onComplete?: (spawnedItem: ItemSnap) => void,
        shouldScheduleHandTut: boolean = false
    ): ItemSnap | null {
        if (this.isReachedLimit || this.currentItemIndex >= this.dynamicItems.length) {
            return null;
        }

        const item = this.dynamicItems[this.currentItemIndex];
        this.currentItemIndex++;

        if (!item || !item.node) {
            return null;
        }

        const targetContainer = this.itemsContainer || this.spawnAreaNode || this.node;
        const containerUT = targetContainer.getComponent(UITransform) || targetContainer.addComponent(UITransform);
        const itemNode = item.node;

        this.applyContainerLayer(itemNode, targetContainer);

        if (itemNode.parent !== targetContainer) {
            itemNode.setParent(targetContainer);
        }
        item.originalParent = targetContainer;

        // 1. Tính toán toạ độ xuất phát (vị trí Box) theo Local của targetContainer
        const startLocalPos = containerUT.convertToNodeSpaceAR(sourceWorldPos);

        // 2. Tính toán toạ độ đích ngẫu nhiên trong vùng spawnArea
        const areaRandomLocal = this.GetRandomLocalPositionInArea();
        const areaNode = this.spawnAreaNode || this.node;
        const areaUT = areaNode.getComponent(UITransform) || areaNode.addComponent(UITransform);
        const worldTarget = areaUT.convertToWorldSpaceAR(areaRandomLocal);
        const targetLocalPos = containerUT.convertToNodeSpaceAR(worldTarget);

        item.homeSlot = null;
        Tween.stopAllByTarget(itemNode);

        // Đặt vị trí bắt đầu tại hộp với scale = 0
        itemNode.setPosition(startLocalPos);
        itemNode.setScale(Vec3.ZERO);
        item.DisableAnimatorOnSpawn();

        // Áp dụng góc xoay ngẫu nhiên NGAY TỪ LÚC XUẤT PHÁT và giữ nguyên suốt quá trình bay
        item.isSpawnInitialized = true;
        item.ApplyRandomSpawnRotation();

        const targetScale = item.GetWaitingScale();
        item.BringToFront();
        itemNode.active = true;
        item.enabled = true;
        item.isDragLocked = this.lockDragOnSpawn;

        // Đang bay: không cho kéo, không cho hand tut bám vào
        item.ChangeState(ItemState.Flying);
        this.inFlightCount++;

        this.bindItemHandTutEvents(item);

        const actualJumpHeight = jumpHeight + (itemIndexInBatch % 2 === 0 ? 15 : -15);

        // 1. TWEEN SCALE: Zoom từ 0 lên targetScale; nếu bật flyPunch thì khi gần tới nơi
        //    phình lên flyPunchScale rồi nảy về targetScale đúng lúc tiếp đất
        if (this.enableFlyPunch) {
            const growDuration = flyDuration * math.clamp(this.flyPunchStartRatio, 0.3, 0.95);
            const punchDuration = flyDuration - growDuration;
            const peakScale = targetScale.clone().multiplyScalar(this.flyPunchScale);

            tween(itemNode)
                .to(growDuration, { scale: targetScale }, { easing: 'quadOut' })
                .to(punchDuration * 0.4, { scale: peakScale }, { easing: 'quadOut' })
                .to(punchDuration * 0.6, { scale: targetScale }, { easing: 'backOut' })
                .start();
        } else {
            tween(itemNode)
                .to(flyDuration, { scale: targetScale }, { easing: 'backOut' })
                .start();
        }

        // 2. TWEEN POSITION: Jump Parabol từ startLocalPos tới targetLocalPos (giữ nguyên góc xoay)
        const animState = { t: 0 };
        const tempPos = new Vec3();

        tween(animState)
            .to(flyDuration, { t: 1 }, {
                easing: 'linear',
                onUpdate: () => {
                    const t = animState.t;
                    tempPos.x = startLocalPos.x + (targetLocalPos.x - startLocalPos.x) * t;
                    const linearY = startLocalPos.y + (targetLocalPos.y - startLocalPos.y) * t;
                    const arcY = actualJumpHeight * Math.sin(t * Math.PI);
                    tempPos.y = linearY + arcY;
                    tempPos.z = 0;
                    itemNode.setPosition(tempPos);
                }
            })
            .call(() => {
                itemNode.setPosition(targetLocalPos);
                itemNode.setScale(targetScale);

                item.waitingPosition = itemNode.worldPosition.clone();
                item.ChangeState(ItemState.Waiting);
                this.inFlightCount = Math.max(0, this.inFlightCount - 1);

                if (this.enableIdleBobbing) {
                    item.StartIdleBobbing();
                }

                (GameManager.Ins as any)?.AddItemToTutorial?.(item);
                if (shouldScheduleHandTut) {
                    HandTutManager.Ins?.ResetHandTutDelay();
                }
                onComplete?.(item);
            })
            .start();

        return item;
    }

    /**
     * Kích hoạt Hand Tutorial ngay lập tức không có thời gian chờ (delay = 0).
     */
    public TriggerImmediateHandTut(): void {
        HandTutManager.Ins?.StartHandTutNoDelay();
    }

    /**
     * Punch (nảy scale) item một phát. ItemSnap gọi ngay sau khi snap đúng vào holder.
     */
    public PunchItem(item: ItemSnap): void {
        if (!this.enablePunchOnPlaced || !item || !item.node || !item.node.isValid) return;

        const node = item.node;
        const base = node.scale.clone();
        const duration = Math.max(0.05, this.punchDuration);

        // Thì 1 - bè: nở ngang theo X, bẹt xuống theo Y.
        const squash = new Vec3(base.x * this.punchScaleX, base.y * this.punchScaleY, base.z);

        const rebound = math.clamp01(this.punchReboundRatio);
        if (rebound <= 0) {
            tween(node)
                .to(duration * 0.4, { scale: squash }, { easing: 'quadOut' })
                .to(duration * 0.6, { scale: base }, { easing: 'backOut' })
                .start();
            return;
        }

        // Thì 2 - dội ngược: vươn cao, thon lại. Lấy đối xứng của thì 1 qua base rồi nhân
        // reboundRatio, nên chỉnh punchScaleX/Y là hai thì tự khớp nhau, không lệch pha.
        const stretch = new Vec3(
            base.x * (1 - (this.punchScaleX - 1) * rebound),
            base.y * (1 + (1 - this.punchScaleY) * rebound),
            base.z,
        );

        tween(node)
            .to(duration * 0.35, { scale: squash }, { easing: 'quadOut' })
            .to(duration * 0.30, { scale: stretch }, { easing: 'sineInOut' })
            .to(duration * 0.35, { scale: base }, { easing: 'backOut' })
            .start();
    }

    /**
     * Được gọi tự động từ ItemSnap khi một item được gắn vào holder thành công.
     */
    public SpawnNextItemToVacatedTarget(targetPosition?: Vec3, onComplete?: () => void): void {
        this.OnItemPlacedSuccessfully();

        if (this.isReachedLimit) {
            onComplete?.();
            return;
        }

        if (this.spawnMode === AreaSpawnMode.Continuous && this.HasItems()) {
            this.SpawnNextItem(() => {
                onComplete?.();
            });
        } else {
            onComplete?.();
        }
    }

    /**
     * Ghi nhận một item đã được đặt/drop trúng vị trí thành công.
     */
    public OnItemPlacedSuccessfully(item?: ItemSnap): void {
        if (this.isReachedLimit) return;

        this.placedItemCount++;
        const targetLimit = this.maxPlacedItemsToWin > 0 ? this.maxPlacedItemsToWin : this.dynamicItems.length;

        console.log(`[ItemSpawnManager] Đã đặt đúng: ${this.placedItemCount}/${targetLimit} item`);

        if (this.placedItemCount >= targetLimit) {
            this.isReachedLimit = true;
            this.onReachedPlacementLimit();
        }
    }

    /**
     * Xử lý khi đạt đủ số lượng item drop trúng mục tiêu.
     */
    private onReachedPlacementLimit(): void {
        this.onPlacementLimitReached.invoke();

        this.scheduleOnce(() => {
            if (this.autoStopAndGoToStoreOnLimit && GameManager.Ins) {
                console.log('🎉 [ItemSpawnManager] Đạt mốc hoàn thành! Gọi StopGame & GotoStore...');
                GameManager.Ins.StopGame();
                GameManager.Ins.GotoStore();
            }
        }, this.storeRedirectDelay);
    }

    /**
     * Phân bổ vị trí đích đều nhau và ngẫu nhiên trong vùng spawnAreaNode.
     */
    public GetDistributedTargetPositionInArea(index: number, totalCount: number): Vec3 {
        const area = this.spawnAreaNode || this.node;
        const ut = area.getComponent(UITransform) || area.addComponent(UITransform);

        const width = ut.width || 400;
        const height = ut.height || 200;
        const anchorX = ut.anchorX;
        const anchorY = ut.anchorY;

        const minX = -anchorX * width + this.spawnAreaPadding.x;
        const maxX = (1 - anchorX) * width - this.spawnAreaPadding.x;
        const minY = -anchorY * height + this.spawnAreaPadding.y;
        const maxY = (1 - anchorY) * height - this.spawnAreaPadding.y;

        if (totalCount <= 1) {
            return new Vec3(math.randomRange(minX, maxX), math.randomRange(minY, maxY), 0);
        }

        const stepX = (maxX - minX) / totalCount;
        const segmentCenterX = minX + stepX * (index + 0.5);
        const randomX = math.randomRange(segmentCenterX - stepX * 0.35, segmentCenterX + stepX * 0.35);
        const randomY = math.randomRange(minY, maxY);

        return new Vec3(randomX, randomY, 0);
    }

    /**
     * Tính toán một toạ độ Local ngẫu nhiên bên trong bounding box của spawnAreaNode.
     */
    public GetRandomLocalPositionInArea(): Vec3 {
        const area = this.spawnAreaNode || this.node;
        const ut = area.getComponent(UITransform) || area.addComponent(UITransform);

        const width = ut.width || 400;
        const height = ut.height || 200;
        const anchorX = ut.anchorX;
        const anchorY = ut.anchorY;

        const minX = -anchorX * width + this.spawnAreaPadding.x;
        const maxX = (1 - anchorX) * width - this.spawnAreaPadding.x;
        const minY = -anchorY * height + this.spawnAreaPadding.y;
        const maxY = (1 - anchorY) * height - this.spawnAreaPadding.y;

        const effectiveMinX = minX < maxX ? minX : -width * 0.5;
        const effectiveMaxX = minX < maxX ? maxX : width * 0.5;
        const effectiveMinY = minY < maxY ? minY : -height * 0.5;
        const effectiveMaxY = minY < maxY ? maxY : height * 0.5;

        const attempts = Math.max(1, Math.floor(this.maxSpawnPositionAttempts));
        const candidateLocal = new Vec3();

        // Rejection sampling: thử nhiều điểm random cho tới khi nằm ngoài toàn bộ CantSpawnArea.
        for (let i = 0; i < attempts; i++) {
            candidateLocal.set(
                math.randomRange(effectiveMinX, effectiveMaxX),
                math.randomRange(effectiveMinY, effectiveMaxY),
                0
            );

            if (this.isSpawnPointAllowed(candidateLocal, area, ut)) {
                return candidateLocal.clone();
            }
        }

        // Fallback: quét lưới để tìm nhanh 1 điểm hợp lệ nếu random chưa trúng.
        const gridSize = 6;
        for (let gy = 0; gy < gridSize; gy++) {
            const ty = gridSize === 1 ? 0.5 : gy / (gridSize - 1);
            const y = effectiveMinY + (effectiveMaxY - effectiveMinY) * ty;

            for (let gx = 0; gx < gridSize; gx++) {
                const tx = gridSize === 1 ? 0.5 : gx / (gridSize - 1);
                const x = effectiveMinX + (effectiveMaxX - effectiveMinX) * tx;
                candidateLocal.set(x, y, 0);

                if (this.isSpawnPointAllowed(candidateLocal, area, ut)) {
                    return candidateLocal.clone();
                }
            }
        }

        console.warn('[ItemSpawnManager] Không tìm được vị trí spawn hợp lệ ngoài CantSpawnArea. Dùng fallback ngẫu nhiên trong SpawnArea.');
        return new Vec3(
            math.randomRange(effectiveMinX, effectiveMaxX),
            math.randomRange(effectiveMinY, effectiveMaxY),
            0
        );
    }

    private isSpawnPointAllowed(localPosInSpawnArea: Vec3, areaNode: Node, areaUT: UITransform): boolean {
        if (!this.cantSpawnAreas || this.cantSpawnAreas.length === 0) return true;

        const worldPos = areaUT.convertToWorldSpaceAR(localPosInSpawnArea);
        for (let i = 0; i < this.cantSpawnAreas.length; i++) {
            const blockArea = this.cantSpawnAreas[i];
            if (!blockArea || !blockArea.isValid || !blockArea.activeInHierarchy) continue;
            if (this.isWorldPointInsideRectArea(worldPos, blockArea)) {
                return false;
            }
        }
        return true;
    }

    private isWorldPointInsideRectArea(worldPos: Vec3, areaNode: Node): boolean {
        const ut = areaNode.getComponent(UITransform) || areaNode.addComponent(UITransform);
        const localPos = ut.convertToNodeSpaceAR(worldPos);
        const width = ut.width || ut.contentSize.width || 0;
        const height = ut.height || ut.contentSize.height || 0;
        const anchorX = ut.anchorX;
        const anchorY = ut.anchorY;

        const minX = -anchorX * width;
        const maxX = (1 - anchorX) * width;
        const minY = -anchorY * height;
        const maxY = (1 - anchorY) * height;

        return localPos.x >= minX
            && localPos.x <= maxX
            && localPos.y >= minY
            && localPos.y <= maxY;
    }

    /** Giao item cho HandTutManager: nó tự bind event và tự chọn item để gợi ý. */
    private bindItemHandTutEvents(item: ItemSnap): void {
        if (!item || !this.enableSpawnHandTut) return;
        HandTutManager.Ins?.AddItemSnap(item);
    }

    /** Item đang chờ nằm trên cùng (siblingIndex lớn nhất). ItemBox dùng để biết còn item trên màn hay không. */
    private getTopPriorityWaitingItem(): ItemSnap | null {
        // Bỏ qua item mà requiredItems của nó chưa được đặt (chưa thể snap được thì không tính)
        const candidates = this.dynamicItems.filter(item => {
            return !!item
                && !!item.node
                && item.node.activeInHierarchy
                && item.enabled
                && item.currentState === ItemState.Waiting
                && item.CanPlaced();
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => b.node.getSiblingIndex() - a.node.getSiblingIndex());

        return candidates[0];
    }
}
