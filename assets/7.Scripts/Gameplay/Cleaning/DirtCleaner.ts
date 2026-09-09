import { _decorator, Component, Node, Vec3, UITransform, EventTarget, clamp01 } from 'cc';
import { DirtMaskRenderer } from './DirtMaskRenderer';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_EventHandlerComponent } from '../Framework/Ply_EventHandlerComponent';

const { ccclass, property } = _decorator;

export const WebEvent = {
    ON_PROGRESS: 'web-progress',
    ON_COMPLETE: 'web-complete',
};

export const webEventTarget = new EventTarget();

@ccclass('DirtCleaner')
export class DirtCleaner extends Ply_EventHandlerComponent {
    @property({ type: DirtMaskRenderer, tooltip: 'Tham chiếu tới DirtMaskRenderer' })
    public maskRenderer: DirtMaskRenderer = null!;

    @property({ tooltip: 'Cho phép quét mạng nhện hay không' })
    public canClean: boolean = true;

    @property({ tooltip: 'Bán kính quét của đầu chổi (pixel theo kích thước WebSprite)' })
    public brushRadius: number = 35;

    @property({ tooltip: 'Tỉ lệ hoàn thành để kích hoạt Complete (0.93 = 93%)' })
    public completeThreshold: number = 0.93;

    @property({ tooltip: 'Hệ số khoảng cách giữa các bước nội suy (0.3 = 30% bán kính cọ)' })
    public spacingFactor: number = 0.3;

    @property({ type: Ply_Event, tooltip: 'Sự kiện được gọi khi hoàn thành quét mạng nhện (kéo thả hàm xử lý trong Inspector)' })
    public onComplete: Ply_Event = new Ply_Event();

    // Kích thước logic grid
    private readonly GRID_WIDTH = 64;
    private readonly GRID_HEIGHT = 64;

    private cleanGrid!: Uint8Array;
    private webGrid!: Uint8Array;

    private totalWebCells: number = 0;
    private cleanedCount: number = 0;
    private isCompleted: boolean = false;

    private _uiTransform: UITransform = null!;

    public get IsCompleted(): boolean {
        return this.isCompleted;
    }

    onLoad() {
        this._uiTransform = this.node.getComponent(UITransform) || this.getComponentInChildren(UITransform)!;
        this.cleanGrid = new Uint8Array(this.GRID_WIDTH * this.GRID_HEIGHT);
        this.webGrid = new Uint8Array(this.GRID_WIDTH * this.GRID_HEIGHT);

        this.initWebGrid();
    }

    public CanClean(canClean: boolean) {
        this.canClean = canClean;
    }

    public EnableClean() {
        this.canClean = true;
    }

    public DisableClean() {
        this.canClean = false;
    }

    private getTargetUITransform(): UITransform {
        if (this.maskRenderer && this.maskRenderer.targetSprite) {
            const spriteUI = this.maskRenderer.targetSprite.getComponent(UITransform);
            if (spriteUI && spriteUI.contentSize.width > 0) {
                return spriteUI;
            }
        }
        if (!this._uiTransform || this._uiTransform.contentSize.width <= 0) {
            this._uiTransform = this.node.getComponent(UITransform) || this.getComponentInChildren(UITransform)!;
        }
        return this._uiTransform;
    }

    /**
     * Khởi tạo các cell thực sự có mạng nhện
     */
    private initWebGrid() {
        this.totalWebCells = 0;
        this.cleanedCount = 0;
        this.isCompleted = false;
        this.cleanGrid.fill(0);

        const centerX = this.GRID_WIDTH / 2;
        const centerY = this.GRID_HEIGHT / 2;
        const radius = this.GRID_WIDTH / 2;
        const radiusSq = radius * radius;

        // Vùng mạng nhện thực tế (loại bỏ góc transparent ngoài vùng tròn)
        for (let y = 0; y < this.GRID_HEIGHT; y++) {
            for (let x = 0; x < this.GRID_WIDTH; x++) {
                const dx = x - centerX + 0.5;
                const dy = y - centerY + 0.5;
                const index = y * this.GRID_WIDTH + x;

                if (dx * dx + dy * dy <= radiusSq) {
                    this.webGrid[index] = 1;
                    this.totalWebCells++;
                } else {
                    this.webGrid[index] = 0;
                }
            }
        }
    }

    /**
     * Quét liên tục giữa 2 điểm (chống đứt quãng khi vuốt nhanh)
     */
    public sweepBetween(previousWorldPos: Vec3, currentWorldPos: Vec3) {
        if (!this.canClean || this.isCompleted) return;

        const distance = Vec3.distance(previousWorldPos, currentWorldPos);
        const spacing = Math.max(1, this.brushRadius * this.spacingFactor);
        const count = Math.ceil(distance / spacing);

        const tempPos = new Vec3();
        for (let i = 0; i <= count; i++) {
            const t = count === 0 ? 0 : i / count;
            Vec3.lerp(tempPos, previousWorldPos, currentWorldPos, t);
            this.cleanAt(tempPos);
        }
    }

    /**
     * Quét tại 1 điểm tọa độ World
     */
    public cleanAt(worldPosition: Vec3) {
        if (!this.canClean || this.isCompleted) return;

        const uiTrans = this.getTargetUITransform();
        if (!uiTrans) return;

        // 1. Chuyển World Position -> Local Position của Web Node
        const localPos = uiTrans.convertToNodeSpaceAR(worldPosition);

        const width = uiTrans.contentSize.width;
        const height = uiTrans.contentSize.height;
        const anchorX = uiTrans.anchorPoint.x;
        const anchorY = uiTrans.anchorPoint.y;

        // 2. Chuyển sang UV [0..1]
        const u = clamp01((localPos.x + width * anchorX) / width);
        const v = clamp01((localPos.y + height * anchorY) / height);

        // Bỏ qua nếu brush nằm hoàn toàn ngoài bounding box
        if (localPos.x < -width * anchorX - this.brushRadius || 
            localPos.x > width * (1 - anchorX) + this.brushRadius ||
            localPos.y < -height * anchorY - this.brushRadius || 
            localPos.y > height * (1 - anchorY) + this.brushRadius) {
            return;
        }

        // 3. Cập nhật GPU Mask Texture
        const brushRadiusUV = this.brushRadius / width;
        if (this.maskRenderer) {
            this.maskRenderer.drawCircleUV(u, v, brushRadiusUV);
        }

        // 4. Cập nhật CPU Grid
        this.updateCleanGrid(u, v, uiTrans);

        // 5. Kiểm tra Progress
        this.checkProgress();
    }

    private updateCleanGrid(u: number, v: number, uiTrans: UITransform) {
        const centerGridX = u * this.GRID_WIDTH;
        const centerGridY = v * this.GRID_HEIGHT;

        const width = uiTrans.contentSize.width;
        const height = uiTrans.contentSize.height;

        const gridRadiusX = (this.brushRadius / width) * this.GRID_WIDTH;
        const gridRadiusY = (this.brushRadius / height) * this.GRID_HEIGHT;
        const avgRadius = (gridRadiusX + gridRadiusY) * 0.5;
        const radiusSq = avgRadius * avgRadius;

        const minX = Math.max(0, Math.floor(centerGridX - gridRadiusX));
        const maxX = Math.min(this.GRID_WIDTH - 1, Math.ceil(centerGridX + gridRadiusX));
        const minY = Math.max(0, Math.floor(centerGridY - gridRadiusY));
        const maxY = Math.min(this.GRID_HEIGHT - 1, Math.ceil(centerGridY + gridRadiusY));

        for (let gy = minY; gy <= maxY; gy++) {
            const dy = gy - centerGridY;
            for (let gx = minX; gx <= maxX; gx++) {
                const dx = gx - centerGridX;

                // So sánh bình phương khoảng cách
                if (dx * dx + dy * dy <= radiusSq) {
                    const idx = gy * this.GRID_WIDTH + gx;
                    if (this.webGrid[idx] === 1 && this.cleanGrid[idx] === 0) {
                        this.cleanGrid[idx] = 1;
                        this.cleanedCount++;
                    }
                }
            }
        }
    }

    private checkProgress() {
        if (this.totalWebCells === 0) return;

        const progress = this.cleanedCount / this.totalWebCells;
        webEventTarget.emit(WebEvent.ON_PROGRESS, progress);

        if (progress >= this.completeThreshold && !this.isCompleted) {
            this.isCompleted = true;
            this.onCompleteInternal();
        }
    }

    private onCompleteInternal() {
        if (this.maskRenderer) {
            this.maskRenderer.fillAll();
        }
        this.onComplete.invoke();
        webEventTarget.emit(WebEvent.ON_COMPLETE);
    }

    public reset() {
        this.isCompleted = false;
        this.cleanedCount = 0;
        this.cleanGrid.fill(0);
        if (this.maskRenderer) {
            this.maskRenderer.reset();
        }
        webEventTarget.emit(WebEvent.ON_PROGRESS, 0);
    }

    public getProgress(): number {
        return this.totalWebCells > 0 ? this.cleanedCount / this.totalWebCells : 0;
    }

    /** Checks whether a world point is inside (or near) the cleaner target bounds. */
    public IsPointInsideCleanArea(worldPosition: Vec3, extraPadding: number = 0): boolean {
        const uiTrans = this.getTargetUITransform();
        if (!uiTrans) return false;

        const localPos = uiTrans.convertToNodeSpaceAR(worldPosition);
        const width = uiTrans.contentSize.width;
        const height = uiTrans.contentSize.height;
        const anchorX = uiTrans.anchorPoint.x;
        const anchorY = uiTrans.anchorPoint.y;
        const padding = Math.max(0, extraPadding);

        if (localPos.x < -width * anchorX - padding) return false;
        if (localPos.x > width * (1 - anchorX) + padding) return false;
        if (localPos.y < -height * anchorY - padding) return false;
        if (localPos.y > height * (1 - anchorY) + padding) return false;
        return true;
    }
}
