import { _decorator, Component, Node, Vec2, Vec3, Enum, Tween, tween, UITransform, math, director, Layers, UIOpacity } from 'cc';
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

    @property({ min: 0, tooltip: 'Số item spawn ban đầu khi vào game / mỗi lần ItemBox click (nếu box không override). 0 = không spawn lúc start; ItemBox click sẽ spawn toàn bộ item còn lại' })
    public initialSpawnCount: number = 3;

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

    @property({ min: 1, tooltip: 'Hệ số scale đỉnh của punch (1.2 = phình to 20% rồi về lại)' })
    public punchScale: number = 1.2;

    @property({ min: 0.05, tooltip: 'Tổng thời gian punch (giây)' })
    public punchDuration: number = 0.25;

    // =============================================================

    @property({ tooltip: 'Bật hand tutorial tự động sau khi spawn item' })
    public enableSpawnHandTut: boolean = true;

    @property({ type: Node, tooltip: 'Node hand dùng cho ItemSnap tutorial. Nếu để trống sẽ dùng HandTutManager.Ins.handNode' })
    public handTutNode: Node | null = null;

    @property({ min: 0, tooltip: 'Delay trước khi hiện hand tutorial sau lần spawn gần nhất (giây)' })
    public handTutDelay: number = 7;

    @property({ min: 0.01, tooltip: 'Thời gian hand di chuyển từ item tới holder' })
    public handTutMoveDuration: number = 1.2;

    @property({ min: 0, tooltip: 'Thời gian dừng giữa các vòng lặp hand tutorial' })
    public handTutWaitAtEndDuration: number = 0.2;

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
    private activeHandTutItem: ItemSnap | null = null;
    private handTutToken: number = 0;
    private handTutOpacity: UIOpacity | null = null;
    private handTutDefaultAlpha: number = 255;
    private handTutBoundItems: Set<ItemSnap> = new Set<ItemSnap>();
    private hasShownInitialSpawnHandTut: boolean = false;
    private initialHandTutRetryCount: number = 0;
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

        if (!this.handTutNode) {
            this.handTutNode = HandTutManager.Ins?.handNode || null;
        }
        if (this.handTutNode) {
            this.handTutOpacity = this.handTutNode.getComponent(UIOpacity);
            this.handTutDefaultAlpha = this.handTutOpacity?.opacity ?? 255;
            this.handTutNode.active = false;
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

    protected onDisable(): void {
        this.cancelSpawnHandTut();
    }

    protected onDestroy(): void {
        this.cancelSpawnHandTut();
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

    private getSpawnSourceWorldPos(): Vec3 | null {
        return this.HasSpawnSource() ? this.spawnSourceNode!.worldPosition.clone() : null;
    }

    // ==================== BATCH SPAWN ====================

    /**
     * Spawn đợt item ban đầu vào trong vùng spawn (dùng khi autoSpawnOnStart = true).
     */
    public RevealInitialItems(): void {
        if (this.initialSpawnCount > 0) {
            this.SpawnBatch(this.initialSpawnCount);
        } else {
            this.onBatchLanded();
        }
        (GameManager.Ins as any)?.TriggerTutorial?.();
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
        if (this.inFlightCount > 0) return;
        this.scheduleSpawnHandTut(true);
        this.hasShownInitialSpawnHandTut = true;
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

        // Đảm bảo layer UI_2D để Camera UI nhìn thấy được
        const containerLayer = targetContainer.layer || Layers.Enum.UI_2D;
        itemNode.layer = containerLayer;
        for (const child of itemNode.children) {
            child.layer = containerLayer;
        }

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
        item.ChangeState(ItemState.Waiting);

        tween(itemNode)
            .to(this.revealDuration, { scale: targetScale }, { easing: 'backOut' })
            .call(() => {
                if (this.enableIdleBobbing) {
                    item.StartIdleBobbing();
                }
                if (shouldScheduleHandTut) {
                    this.scheduleSpawnHandTut();
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

        const containerLayer = targetContainer.layer || Layers.Enum.UI_2D;
        itemNode.layer = containerLayer;
        for (const child of itemNode.children) {
            child.layer = containerLayer;
        }

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

        // Đang bay: không cho kéo, không cho hand tut bám vào
        item.ChangeState(ItemState.Flying);
        this.inFlightCount++;

        this.bindItemHandTutEvents(item);

        const actualJumpHeight = jumpHeight + (itemIndexInBatch % 2 === 0 ? 15 : -15);

        // 1. TWEEN SCALE: Zoom đồng thời từ 0 lên targetScale với hiệu ứng đàn hồi backOut
        tween(itemNode)
            .to(flyDuration, { scale: targetScale }, { easing: 'backOut' })
            .start();

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
                    this.scheduleSpawnHandTut();
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
        this.scheduleSpawnHandTut(true);
    }

    /**
     * Punch (nảy scale) item một phát. ItemSnap gọi ngay sau khi snap đúng vào holder.
     */
    public PunchItem(item: ItemSnap): void {
        if (!this.enablePunchOnPlaced || !item || !item.node || !item.node.isValid) return;

        const node = item.node;
        const base = node.scale.clone();
        const peak = base.clone().multiplyScalar(this.punchScale);

        tween(node)
            .to(this.punchDuration * 0.4, { scale: peak }, { easing: 'quadOut' })
            .to(this.punchDuration * 0.6, { scale: base }, { easing: 'backOut' })
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

    private bindItemHandTutEvents(item: ItemSnap): void {
        if (!item || this.handTutBoundItems.has(item)) return;

        this.handTutBoundItems.add(item);
        item.onStartDrag.addListener(() => {
            this.cancelSpawnHandTut();
        });
        item.onPlacedSuccess.addListener(() => {
            this.cancelSpawnHandTut();
        });
        item.onPlacedFail.addListener(() => {
            this.scheduleSpawnHandTut();
        });
    }

    private scheduleSpawnHandTut(noDelay: boolean = false): void {
        if (!this.enableSpawnHandTut || !this.isValid) return;

        this.unschedule(this.showSpawnHandTut);
        this.hideSpawnHandTut();

        if (noDelay) {
            this.initialHandTutRetryCount = 0;
            this.showSpawnHandTut();
            return;
        }

        this.scheduleOnce(this.showSpawnHandTut, this.handTutDelay);
    }

    private showSpawnHandTut = (): void => {
        if (!this.enableSpawnHandTut || !this.node.activeInHierarchy) return;

        // Còn item đang bay thì chưa hiện hand; đợt tiếp đất xong sẽ tự gọi lại
        if (this.inFlightCount > 0) return;

        const shown = this.tryShowSpawnHandTut();

        // No-delay initial hand tut có thể bị gọi sớm hơn lúc hand node sẵn sàng.
        // Retry ngắn để đảm bảo vẫn hiện được hand đầu tiên.
        if (!shown && !this.hasShownInitialSpawnHandTut && this.initialHandTutRetryCount < 20) {
            this.initialHandTutRetryCount++;
            this.scheduleOnce(this.showSpawnHandTut, 0.2);
        }
    };

    private tryShowSpawnHandTut(): boolean {
        const handNode = this.handTutNode || HandTutManager.Ins?.handNode || null;
        if (!handNode || !handNode.isValid) return false;

        const targetItem = this.getTopPriorityWaitingItem();
        if (!targetItem || !targetItem.node || !targetItem.node.activeInHierarchy) return false;

        const startPos = targetItem.node.worldPosition.clone();
        const endPos = (targetItem.correctHolderTransform?.activeInHierarchy
            ? targetItem.correctHolderTransform.worldPosition
            : targetItem.node.worldPosition).clone();

        this.activeHandTutItem = targetItem;
        this.handTutNode = handNode;
        this.handTutOpacity = handNode.getComponent(UIOpacity);

        this.bringHandToFront();
        this.handTutToken++;
        const token = this.handTutToken;

        handNode.active = true;
        handNode.setWorldPosition(startPos);
        this.setHandTutAlpha(this.handTutDefaultAlpha);

        const loop = () => {
            if (token !== this.handTutToken || !this.canContinueHandTut(targetItem)) {
                this.hideSpawnHandTut();
                return;
            }

            this.bringHandToFront();
            handNode.setWorldPosition(targetItem.node.worldPosition);
            this.setHandTutAlpha(this.handTutDefaultAlpha);

            if (targetItem.correctHolderTransform?.activeInHierarchy) {
                endPos.set(targetItem.correctHolderTransform.worldPosition);
            } else {
                endPos.set(targetItem.node.worldPosition);
            }

            tween(handNode)
                .to(this.handTutMoveDuration, { worldPosition: endPos }, { easing: 'sineInOut' })
                .call(() => this.setHandTutAlpha(0))
                .delay(this.handTutWaitAtEndDuration)
                .call(loop)
                .start();
        };

        loop();
        return true;
    }

    private getTopPriorityWaitingItem(): ItemSnap | null {
        const candidates = this.dynamicItems.filter(item => {
            return !!item
                && !!item.node
                && item.node.activeInHierarchy
                && item.enabled
                && item.currentState === ItemState.Waiting;
        });

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            const aut = a.getComponent(UITransform);
            const but = b.getComponent(UITransform);
            const ap = aut?.priority ?? 0;
            const bp = but?.priority ?? 0;
            if (ap !== bp) return bp - ap;

            const ai = a.node.getSiblingIndex();
            const bi = b.node.getSiblingIndex();
            return bi - ai;
        });

        return candidates[0];
    }

    private canContinueHandTut(item: ItemSnap): boolean {
        return !!item
            && !!item.node
            && item.node.activeInHierarchy
            && item.enabled
            && item.currentState === ItemState.Waiting
            && !this.isReachedLimit;
    }

    private hideSpawnHandTut(): void {
        if (!this.handTutNode || !this.handTutNode.isValid) return;
        Tween.stopAllByTarget(this.handTutNode);
        this.handTutNode.active = false;
        this.setHandTutAlpha(this.handTutDefaultAlpha);
    }

    private cancelSpawnHandTut(): void {
        this.unschedule(this.showSpawnHandTut);
        this.handTutToken++;
        this.activeHandTutItem = null;
        this.hideSpawnHandTut();
    }

    private setHandTutAlpha(alpha: number): void {
        if (!this.handTutNode) return;
        if (!this.handTutOpacity || !this.handTutOpacity.isValid) {
            this.handTutOpacity = this.handTutNode.getComponent(UIOpacity);
        }
        if (this.handTutOpacity) {
            this.handTutOpacity.opacity = alpha;
        }
    }

    private bringHandToFront(): void {
        if (!this.handTutNode || !this.handTutNode.parent) return;
        this.handTutNode.setSiblingIndex(this.handTutNode.parent.children.length - 1);
    }
}
