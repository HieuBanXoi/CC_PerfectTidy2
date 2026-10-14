import { _decorator, Component, Enum } from 'cc';

const { ccclass, property } = _decorator;

export enum CleanRegionShape {
    Rectangle = 0,
    Oval = 1,
}
Enum(CleanRegionShape);

/**
 * Một vùng vết bẩn khó lau trên MaskCleanSurface (đặt trong Clean2Range).
 * Kích thước lấy từ UITransform của node. Lần lau bằng khăn (Tower) chỉ sạch tới towelCleanRatio,
 * cotton_swab mới lau sạch hẳn vùng này.
 */
@ccclass('CleanRegion')
export class CleanRegion extends Component {
    @property({ type: Enum(CleanRegionShape), tooltip: 'Hình dạng vùng: chữ nhật hoặc ovan (theo UITransform).' })
    public shape: CleanRegionShape = CleanRegionShape.Rectangle;

    @property({ min: 0, max: 1, step: 0.05, slide: true, tooltip: 'Mức sạch tối đa khi lau bằng khăn (0.8 = sạch 80%, còn mờ 20%).' })
    public towelCleanRatio = 0.8;
}
