import { _decorator, Component, Node } from 'cc';
import { MaskCleanSurface } from './MaskCleanSurface';

const { ccclass, property } = _decorator;

/** Một mặt của máy ảnh (Back / Front) và các thứ cần làm sạch trên mặt đó. */
@ccclass('CameraFace')
export class CameraFace extends Component {
    @property({ type: Node, tooltip: 'Node chứa các hạt bụi (Dusts) cho bước brush.' })
    public dustRoot: Node | null = null;

    @property({ type: MaskCleanSurface, tooltip: 'Lớp bẩn lau bằng khăn + cotton swab (dirt_and_dust_1).' })
    public dirtSurface: MaskCleanSurface | null = null;

    @property({ type: Node, tooltip: 'Bụi trên kính (dust_on camera_glass) cho bước dust blower.' })
    public glassDust: Node | null = null;

    @property({ type: [Node], tooltip: 'Các vết vân tay cho bước giấy ướt.' })
    public fingerprints: Node[] = [];

    public get Dusts(): Node[] {
        return this.dustRoot?.children ?? [];
    }
}
