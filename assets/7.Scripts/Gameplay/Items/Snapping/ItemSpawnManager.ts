import { _decorator, Component, Node, Vec2, Vec3, Enum, Tween, tween, UITransform, math, director, Layers, UIOpacity, Rect } from 'cc';
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

    @property({ min: 1, tooltip: 'Số lượng item được spawn xuất hiện ban đầu khi vào game' })
    public initialSpawnCount: number = 3;

    @property({ min: 0.1, tooltip: 'Thời gian hiệu ứng phóng to (scale up) khi item xuất hiện' })
    public revealDuration: number = 0.4;

    @property({ tooltip: 'Khoảng cách cách lề bên trong vùng spawn (tránh spawn sát mép viền)' })
    public spawnAreaPadding: Vec2 = new Vec2(30, 30);

    @property({ type: [Node], tooltip: 'Các vùng hình chữ nhật cần loại trừ khi random vị trí spawn item' })
    public cantSpawnAreas: Node[] = [];

    @property({ tooltip: 'Khi spawn nhiều item cùng lúc: rải thoáng ra, hạn chế item sát / đè lên nhau' })
    public spreadRevealedItems: boolean = true;

    @property({ min: 5, tooltip: 'Bước lưới (world) khi tìm chỗ rải item: nhỏ = rải mịn hơn nhưng tính lâu hơn' })
    public spreadGridStep: number = 30;

    @property({ tooltip: 'Đợt spawn đầu: không cho item nào rơi lên holder của item được hand tut gợi ý đầu tiên (tránh che mất chỗ đặt)' })
    public keepFirstHandTutHolderClear: boolean = true;

    @property({ min: 0, tooltip: 'Khoảng hở thêm (world) quanh holder đó mà item không được chạm vào' })
    public firstHandTutHolderClearMargin: number = 0;

    @property({ min: 1, tooltip: 'Số lần thử tìm vị trí hợp lệ ngoài CantSpawnArea trước khi fallback' })
    public maxSpawnPositionAttempts: number = 40;

    @property({ tooltip: 'Hiện bóng mờ (shadowOnHolder) tại chỗ đặt đúng khi kéo item. Tắt: không item nào hiện bóng khi kéo' })
    public showShadowOnDrag: boolean = true;

    @property({ tooltip: 'Bật hiệu ứng nhấp nhô lơ lửng cho item khi ở trạng thái chờ trong vùng' })
    public enableIdleBobbing: boolean = true;

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

    @property({ min: 0, tooltip: 'Thời gian hand mờ dần khi tới đích trước khi lặp lại (giây)' })
    public handTutFadeOutDuration: number = 0.3;

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
        tooltip: 'Bật: StopGame rồi GotoStore luôn. Tắt: chỉ StopGame (chạm màn hình tiếp theo mới mở store)',
        visible(this: ItemSpawnManager) { return this.autoStopAndGoToStoreOnLimit; }
    })
    public goToStoreOnLimit: boolean = true;

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
                if (!this.showShadowOnDrag) item.canShowShadowHint = false;
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

    /**
     * Spawn đợt item ban đầu vào trong vùng spawn.
     */
    public RevealInitialItems(): void {
        const countToSpawn = Math.min(this.initialSpawnCount, this.dynamicItems.length - this.currentItemIndex);

        if (countToSpawn <= 0) {
            (GameManager.Ins as any)?.TriggerTutorial?.();
            return;
        }

        let revealedCount = 0;
        let spawnedCount = 0;

        const isFirstReveal = !this.hasShownInitialSpawnHandTut;
        const spawnedItems: ItemSnap[] = [];

        for (let i = 0; i < countToSpawn; i++) {
            const spawned = this.SpawnNextItem(() => {
                revealedCount++;

                // Lần spawn đầu tiên: hiển thị hand ngay, không delay.
                if (revealedCount >= spawnedCount && !this.hasShownInitialSpawnHandTut) {
                    this.scheduleSpawnHandTut(true);
                    this.hasShownInitialSpawnHandTut = true;
                }
            }, false);

            if (spawned) {
                spawnedCount++;
                spawnedItems.push(spawned);
            }
        }

        // Hand tut đầu gợi ý item nằm trên cùng = item spawn cuối của đợt này (BringToFront khi spawn).
        const tutHolder = this.keepFirstHandTutHolderClear && isFirstReveal && spawnedItems.length > 0
            ? spawnedItems[spawnedItems.length - 1].correctHolderTransform
            : null;
        if (this.spreadRevealedItems && spawnedItems.length > 1) {
            this.spreadItems(spawnedItems, this.getClearRect(tutHolder));
        }
        if (tutHolder) this.clearItemsOffHolder(tutHolder, spawnedItems);

        if (spawnedCount <= 0 && !this.hasShownInitialSpawnHandTut) {
            this.scheduleSpawnHandTut(true);
            this.hasShownInitialSpawnHandTut = true;
        }

        (GameManager.Ins as any)?.TriggerTutorial?.();
    }

    /**
     * Dời các item vừa spawn đang đè lên holder (kể cả item có holder đó) sang vị trí random khác,
     * để chỗ đặt mà hand tut chỉ tới không bị che.
     */
    private clearItemsOffHolder(holder: Node | null, items: ItemSnap[]): void {
        const rect = this.getClearRect(holder);
        if (!rect) return;

        const attempts = Math.max(1, Math.floor(this.maxSpawnPositionAttempts));
        for (const item of items) {
            let moved = false;
            for (let i = 0; i < attempts && this.isItemOverlappingRect(item, rect); i++) {
                item.node.setPosition(this.GetRandomLocalPositionInArea());
                moved = true;
            }
            if (moved) item.waitingPosition = item.node.worldPosition.clone();
        }
    }

    /** Khung world của holder nới rộng firstHandTutHolderClearMargin (null nếu không có holder hợp lệ). */
    private getClearRect(holder: Node | null): Rect | null {
        const holderUT = holder?.isValid && holder.activeInHierarchy ? holder.getComponent(UITransform) : null;
        if (!holderUT) return null;

        const rect = holderUT.getBoundingBoxToWorld();
        const margin = this.firstHandTutHolderClearMargin;
        rect.x -= margin;
        rect.y -= margin;
        rect.width += margin * 2;
        rect.height += margin * 2;
        return rect;
    }

    /** Rải đều các item vừa spawn (đã có góc xoay) trong vùng spawn, hạn chế đè nhau. */
    private spreadItems(items: ItemSnap[], avoidRect: Rect | null): void {
        const targets = this.PlanSpreadWorldPositions(items, avoidRect);
        items.forEach((item, i) => {
            item.node.setWorldPosition(targets[i]);
            item.waitingPosition = targets[i].clone();
        });
    }

    /**
     * Tính vị trí world rải đều trong vùng spawn, hạn chế item đè lên nhau (theo kích thước ở scale chờ
     * và góc xoay hiện tại của từng item). Xếp item to trước: mỗi item thử lưới vị trí phủ cả vùng,
     * chọn chỗ ít diện tích đè nhất (lên item đã xếp, avoidRect, CantSpawnArea); cùng mức đè thì chọn chỗ
     * cách xa các item khác nhất. Trả về vị trí theo đúng thứ tự items.
     */
    public PlanSpreadWorldPositions(items: ItemSnap[], avoidRect: Rect | null = null): Vec3[] {
        const area = this.spawnAreaNode || this.node;
        const areaUT = area.getComponent(UITransform) || area.addComponent(UITransform);
        const bounds = areaUT.getBoundingBoxToWorld();
        const padX = this.spawnAreaPadding.x * Math.abs(area.worldScale.x);
        const padY = this.spawnAreaPadding.y * Math.abs(area.worldScale.y);
        const minX = bounds.xMin + padX, maxX = bounds.xMax - padX;
        const minY = bounds.yMin + padY, maxY = bounds.yMax - padY;
        const container = this.itemsContainer || this.spawnAreaNode || this.node;
        const parentScale = container.worldScale;
        const step = Math.max(5, this.spreadGridStep);
        const blocks = this.cantSpawnAreas
            .filter(node => node?.isValid && node.activeInHierarchy && node.getComponent(UITransform))
            .map(node => node.getComponent(UITransform)!.getBoundingBoxToWorld());

        // Khung bao (AABB world) của từng item khi đã xoay, tính quanh tâm hình (không phải anchor).
        const plans = items.map((item, index) => {
            const ut = item.getComponent(UITransform);
            const scale = item.GetWaitingScale();
            const sx = Math.abs(scale.x * parentScale.x), sy = Math.abs(scale.y * parentScale.y);
            const w = (ut?.width ?? 0) * sx, h = (ut?.height ?? 0) * sy;
            const rad = item.node.angle * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const lx = ut ? (0.5 - ut.anchorX) * w : 0, ly = ut ? (0.5 - ut.anchorY) * h : 0;
            return {
                index,
                hx: (Math.abs(cos) * w + Math.abs(sin) * h) * 0.5,
                hy: (Math.abs(sin) * w + Math.abs(cos) * h) * 0.5,
                ox: lx * cos - ly * sin,
                oy: lx * sin + ly * cos,
            };
        }).sort((a, b) => b.hx * b.hy - a.hx * a.hy);

        const overlap = (cx: number, cy: number, hx: number, hy: number, xMin: number, yMin: number, xMax: number, yMax: number) =>
            Math.max(0, Math.min(cx + hx, xMax) - Math.max(cx - hx, xMin))
            * Math.max(0, Math.min(cy + hy, yMax) - Math.max(cy - hy, yMin));

        const placed: { cx: number; cy: number; hx: number; hy: number }[] = [];
        const result: Vec3[] = items.map(item => item.node.worldPosition.clone());
        const point = new Vec2();
        for (const plan of plans) {
            const { hx, hy } = plan;
            // Giữ cả item nằm trong vùng; item to hơn vùng thì đặt giữa.
            const x0 = Math.min(minX + hx, (minX + maxX) * 0.5), x1 = Math.max(maxX - hx, x0);
            const y0 = Math.min(minY + hy, (minY + maxY) * 0.5), y1 = Math.max(maxY - hy, y0);
            const nx = Math.max(1, Math.ceil((x1 - x0) / step)), ny = Math.max(1, Math.ceil((y1 - y0) / step));

            let bestX = (x0 + x1) * 0.5, bestY = (y0 + y1) * 0.5;
            let bestCost = Number.POSITIVE_INFINITY, bestGap = Number.NEGATIVE_INFINITY;
            for (let gy = 0; gy <= ny; gy++) {
                for (let gx = 0; gx <= nx; gx++) {
                    // Lệch ngẫu nhiên trong ô lưới để các item không thẳng hàng.
                    const cx = math.clamp(x0 + (x1 - x0) * gx / nx + math.randomRange(-0.35, 0.35) * step, x0, x1);
                    const cy = math.clamp(y0 + (y1 - y0) * gy / ny + math.randomRange(-0.35, 0.35) * step, y0, y1);

                    let cost = 0;
                    let gap = Number.POSITIVE_INFINITY;
                    for (const o of placed) {
                        cost += overlap(cx, cy, hx, hy, o.cx - o.hx, o.cy - o.hy, o.cx + o.hx, o.cy + o.hy);
                        gap = Math.min(gap, Math.max(Math.abs(cx - o.cx) - hx - o.hx, Math.abs(cy - o.cy) - hy - o.hy));
                    }
                    if (avoidRect) cost += overlap(cx, cy, hx, hy, avoidRect.xMin, avoidRect.yMin, avoidRect.xMax, avoidRect.yMax) * 4;
                    point.set(cx, cy);
                    for (const block of blocks) {
                        if (block.contains(point)) cost += 1e9;
                    }
                    // Chưa có item nào thì gap = 0 ở mọi chỗ: chọn ngẫu nhiên.
                    const gapScore = (Number.isFinite(gap) ? gap : 0) + Math.random() * step * 0.5;

                    if (cost < bestCost - 1 || (cost <= bestCost + 1 && gapScore > bestGap)) {
                        bestCost = cost;
                        bestGap = gapScore;
                        bestX = cx;
                        bestY = cy;
                    }
                }
            }

            placed.push({ cx: bestX, cy: bestY, hx, hy });
            result[plan.index] = new Vec3(bestX - plan.ox, bestY - plan.oy, 0);
        }
        return result;
    }

    /**
     * Bán kính world của item ở scale chờ (item đang scale 0 vì vừa spawn). useMax = true: vòng bao cả item
     * kể cả khi xoay (chặt); false: theo cạnh ngắn (cho phép các item nằm khít hơn khi rải).
     */
    private getItemWorldRadius(item: ItemSnap, useMax: boolean): number {
        const ut = item.getComponent(UITransform);
        if (!ut) return 0;
        const parentScale = Math.abs(item.node.parent?.worldScale.x ?? 1);
        const size = useMax ? Math.max(ut.width, ut.height) : (ut.width + ut.height) * 0.5;
        return size * 0.5 * Math.abs(item.GetWaitingScale().x) * parentScale;
    }

    /** So theo vòng tròn cỡ trung bình của item ở scale chờ (chỉ né vừa đủ, không đẩy item ra quá xa). */
    private isItemOverlappingRect(item: ItemSnap, rect: Rect): boolean {
        const radius = this.getItemWorldRadius(item, false);
        if (radius <= 0) return false;
        const center = item.node.worldPosition;
        const dx = center.x - math.clamp(center.x, rect.xMin, rect.xMax);
        const dy = center.y - math.clamp(center.y, rect.yMin, rect.yMax);
        return dx * dx + dy * dy < radius * radius;
    }

    /**
     * Spawn item tiếp theo từ danh sách dynamicItems vào một toạ độ ngẫu nhiên trong vùng UITransform.
     */
    public SpawnNextItem(onComplete?: (spawnedItem: ItemSnap) => void, shouldScheduleHandTut: boolean = true): ItemSnap | null {
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
        shouldScheduleHandTut: boolean = false,
        targetWorldPos: Vec3 | null = null,
        keepCurrentRotation: boolean = false
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

        // 2. Toạ độ đích: vị trí đã tính trước (rải đều) hoặc ngẫu nhiên trong vùng spawnArea
        let worldTarget = targetWorldPos;
        if (!worldTarget) {
            const areaNode = this.spawnAreaNode || this.node;
            const areaUT = areaNode.getComponent(UITransform) || areaNode.addComponent(UITransform);
            worldTarget = areaUT.convertToWorldSpaceAR(this.GetRandomLocalPositionInArea());
        }
        const targetLocalPos = containerUT.convertToNodeSpaceAR(worldTarget);

        item.homeSlot = null;
        Tween.stopAllByTarget(itemNode);

        // Đặt vị trí bắt đầu tại hộp với scale = 0
        itemNode.setPosition(startLocalPos);
        itemNode.setScale(Vec3.ZERO);
        item.DisableAnimatorOnSpawn();

        // Áp dụng góc xoay ngẫu nhiên NGAY TỪ LÚC XUẤT PHÁT và giữ nguyên suốt quá trình bay
        item.isSpawnInitialized = true;
        if (!keepCurrentRotation) item.ApplyRandomSpawnRotation();

        const targetScale = item.GetWaitingScale();
        item.BringToFront();
        itemNode.active = true;
        item.enabled = true;

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
     * Spawn count item kế tiếp từ toạ độ hộp, bay ra các vị trí rải đều trong vùng spawn (hạn chế đè nhau).
     * stagger: độ trễ giữa 2 item. Trả về số item sẽ spawn; onAllLanded gọi khi tất cả đã đáp xuống.
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
        const batch = this.dynamicItems.slice(this.currentItemIndex, this.currentItemIndex + Math.max(0, count));
        const total = batch.length;
        if (total <= 0) return 0;

        // Chốt góc xoay trước để tính chỗ chiếm theo đúng góc lúc item đáp xuống.
        const valid = batch.filter(item => !!item?.node);
        valid.forEach(item => {
            item.isSpawnInitialized = true;
            item.ApplyRandomSpawnRotation();
        });
        // Item spawn cuối nằm trên cùng, là item hand tut gợi ý đầu tiên: không che chỗ đặt của nó.
        const tutHolder = this.keepFirstHandTutHolderClear && !this.hasShownInitialSpawnHandTut && valid.length > 0
            ? valid[valid.length - 1].correctHolderTransform
            : null;
        const positions = this.PlanSpreadWorldPositions(valid, this.getClearRect(tutHolder));
        const targets = new Map<ItemSnap, Vec3>();
        valid.forEach((item, i) => targets.set(item, positions[i]));

        let landed = 0;
        const onLanded = () => {
            if (++landed >= total) onAllLanded?.();
        };
        for (let i = 0; i < total; i++) {
            this.scheduleOnce(() => {
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

    /**
     * Kích hoạt Hand Tutorial ngay lập tức không có thời gian chờ (delay = 0).
     */
    public TriggerImmediateHandTut(): void {
        this.scheduleSpawnHandTut(true);
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
                console.log(`🎉 [ItemSpawnManager] Đạt mốc hoàn thành! Gọi StopGame${this.goToStoreOnLimit ? ' & GotoStore' : ''}...`);
                GameManager.Ins.StopGame();
                if (this.goToStoreOnLimit) GameManager.Ins.GotoStore();
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
                .call(() => this.fadeOutHandTut(token, loop))
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

    /** Hand tới đích thì mờ dần, chờ handTutWaitAtEndDuration rồi mới lặp lại. */
    private fadeOutHandTut(token: number, loop: () => void): void {
        if (token !== this.handTutToken || !this.handTutNode) return;
        const opacity = this.handTutOpacity?.isValid ? this.handTutOpacity : this.handTutNode.getComponent(UIOpacity);
        if (!opacity || this.handTutFadeOutDuration <= 0) {
            this.setHandTutAlpha(0);
            this.scheduleOnce(loop, this.handTutWaitAtEndDuration);
            return;
        }
        tween(opacity)
            .to(this.handTutFadeOutDuration, { opacity: 0 }, { easing: 'sineIn' })
            .delay(this.handTutWaitAtEndDuration)
            .call(loop)
            .start();
    }

    private hideSpawnHandTut(): void {
        if (!this.handTutNode || !this.handTutNode.isValid) return;
        Tween.stopAllByTarget(this.handTutNode);
        const opacity = this.handTutNode.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
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
