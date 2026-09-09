import { _decorator, Component, Node, UITransform, Vec3, Rect } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('ItemHolder')
export class ItemHolder extends Component {
    @property({ tooltip: 'Unique ID matching ItemSnap.id' })
    public id: number = 0;

    @property({ tooltip: 'Custom snap radius in UI units. If 0, uses UITransform bounds.' })
    public snapRadius: number = 0;

    @property({ tooltip: 'Extra margin in pixels around the holder to make snapping easier' })
    public extraSnapPadding: number = 50;

    @property({ min: 1.0, tooltip: 'Multiplier to expand the snap hit box' })
    public snapBoundsMultiplier: number = 1.3;

    @property({ type: Node, tooltip: 'Node con nơi Item sẽ được gắn vào (ví dụ: Slot nằm giữa Front và Back). Để trống sẽ gắn trực tiếp vào Holder' })
    public attachSlot: Node | null = null;

    @property({ tooltip: 'Thứ tự Sibling Index khi item gắn vào (ví dụ: 1 để nằm giữa Back[0] và Front[1]). -1: tự nhiên ở cuối' })
    public insertSiblingIndex: number = -1;

    private _uiTransform: UITransform | null = null;

    protected onLoad(): void {
        this._uiTransform = this.getComponent(UITransform);
        if (!this._uiTransform) {
            this._uiTransform = this.addComponent(UITransform);
        }
    }

    /**
     * Checks if a world position point falls inside this holder's snap area.
     */
    public IsPointInside(worldPoint: Vec3, additionalMargin: number = 0): boolean {
        if (!this.node.activeInHierarchy) return false;

        const transform = this._uiTransform || this.getComponent(UITransform);
        if (!transform) return false;

        const totalMargin = this.extraSnapPadding + additionalMargin;

        if (this.snapRadius > 0) {
            const effectiveRadius = (this.snapRadius * this.snapBoundsMultiplier) + totalMargin;
            const myPos = this.node.worldPosition;
            const dx = myPos.x - worldPoint.x;
            const dy = myPos.y - worldPoint.y;
            return (dx * dx + dy * dy) <= (effectiveRadius * effectiveRadius);
        }

        const localPoint = transform.convertToNodeSpaceAR(worldPoint);
        const halfW = (transform.width * 0.5 * this.snapBoundsMultiplier) + totalMargin;
        const halfH = (transform.height * 0.5 * this.snapBoundsMultiplier) + totalMargin;

        const centerX = (0.5 - transform.anchorX) * transform.width;
        const centerY = (0.5 - transform.anchorY) * transform.height;

        return (localPoint.x >= centerX - halfW && localPoint.x <= centerX + halfW)
            && (localPoint.y >= centerY - halfH && localPoint.y <= centerY + halfH);
    }

    /**
     * Checks distance in world pixels between this holder and a world position.
     */
    public GetDistanceTo(worldPoint: Vec3): number {
        return Vec3.distance(this.node.worldPosition, worldPoint);
    }

    /**
     * Checks if another Node's position or bounding box overlaps with this holder.
     */
    public IsOverlapping(otherNode: Node, maxDistanceThreshold: number = 0): boolean {
        if (!otherNode || !otherNode.isValid) return false;
        if (this.IsPointInside(otherNode.worldPosition)) return true;
        if (maxDistanceThreshold > 0) {
            return this.GetDistanceTo(otherNode.worldPosition) <= maxDistanceThreshold;
        }
        return false;
    }
}
