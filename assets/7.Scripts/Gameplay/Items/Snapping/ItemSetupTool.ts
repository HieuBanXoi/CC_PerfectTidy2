import { _decorator, Component, Node, Sprite, UITransform, Color, Vec3, Size } from 'cc';
import { ItemSnap, ItemState } from './ItemSnap';
import { ItemHolder } from './ItemHolder';

const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('ItemSetupTool')
@executeInEditMode
export class ItemSetupTool extends Component {

    @property({ type: Node, tooltip: 'Parent containing item nodes' })
    public itemsParent: Node = null!;

    @property({ type: Node, tooltip: 'Parent where Holder_<item> target nodes are placed' })
    public holdersParent: Node = null!;

    @property({ tooltip: 'Suffix used for shadow nodes (e.g. _sd)' })
    public shadowSuffix: string = '_sd';

    @property({ tooltip: 'Prefix used for target holder nodes' })
    public holderPrefix: string = 'Holder_';

    @property({ tooltip: 'Name of the holders parent container node' })
    public holdersParentName: string = 'ItemHolders';

    @property({ tooltip: 'Color tint for generated shadows' })
    public shadowColor: Color = new Color(0, 0, 0, 60);

    // ==================== EDITOR ACTION BUTTONS ====================

    @property({
        displayName: '▶ [CLICK TO] BAKE ITEM DATA',
        tooltip: 'Tick to automatically bake items, generate holders, assign matching IDs, and link shadows.'
    })
    public get bakeItemDataTrigger(): boolean {
        return false;
    }
    public set bakeItemDataTrigger(value: boolean) {
        if (value) {
            this.BakeItemData();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] REFRESH HOLDERS',
        tooltip: 'Tick to remove unused holder nodes that do not match any item.'
    })
    public get refreshHoldersTrigger(): boolean {
        return false;
    }
    public set refreshHoldersTrigger(value: boolean) {
        if (value) {
            this.RefreshHolderTargets();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] CREATE MISSING SHADOWS',
        tooltip: 'Tick to auto-create target shadows for all holders missing a shadow node.'
    })
    public get createMissingShadowsTrigger(): boolean {
        return false;
    }
    public set createMissingShadowsTrigger(value: boolean) {
        if (value) {
            this.CreateMissingTargetShadows();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] SORT ITEMS BY SIBLING INDEX',
        tooltip: 'Tick to sort items in itemsParent by their ID ascending.'
    })
    public get sortItemsTrigger(): boolean {
        return false;
    }
    public set sortItemsTrigger(value: boolean) {
        if (value) {
            this.SortItemsByOrder();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] SET SHADOWS FADED BLACK',
        tooltip: 'Tick to set all shadow sprites to faded black color.'
    })
    public get setShadowsFadedBlackTrigger(): boolean {
        return false;
    }
    public set setShadowsFadedBlackTrigger(value: boolean) {
        if (value) {
            this.SetAllShadowsToFadedBlack();
        }
    }

    @property({
        displayName: '▶ [CLICK TO] EXTRACT SPRITE TO MODEL',
        tooltip: 'Tick to move SpriteRenderer to a child "Model" node for each item.'
    })
    public get extractSpriteToModelTrigger(): boolean {
        return false;
    }
    public set extractSpriteToModelTrigger(value: boolean) {
        if (value) {
            this.ExtractSpriteToModel();
        }
    }

    // ==================== IMPLEMENTATION LOGIC ====================

    /**
     * Bakes items and creates corresponding ItemHolder nodes with matching IDs.
     */
    public BakeItemData(): void {
        if (!this.itemsParent) {
            this.itemsParent = this.node;
        }

        this.ensureHoldersParent();

        const shadowsByItemName = this.collectShadows();
        const children = [...this.itemsParent.children];
        let count = 0;

        for (let i = 0; i < children.length; i++) {
            const itemNode = children[i];
            if (this.isShadowName(itemNode.name)) continue;

            const sprite = itemNode.getComponent(Sprite) || itemNode.getComponentInChildren(Sprite);
            if (!sprite && itemNode.children.length === 0) continue;

            this.bakeSingleItem(itemNode, sprite, shadowsByItemName, count);
            count++;
        }

        console.log(`✅ [ItemSetupTool] Bake completed! Successfully processed ${count} item(s).`);
    }

    private bakeSingleItem(
        itemNode: Node,
        sprite: Sprite | null,
        shadows: Map<string, Node>,
        index: number
    ): void {
        let itemSnap = itemNode.getComponent(ItemSnap);
        if (!itemSnap) itemSnap = itemNode.addComponent(ItemSnap);

        let itemUT = itemNode.getComponent(UITransform);
        if (!itemUT) {
            itemUT = itemNode.addComponent(UITransform);
            if (sprite) {
                const spriteUT = sprite.getComponent(UITransform);
                if (spriteUT) itemUT.setContentSize(spriteUT.contentSize);
            }
        }

        const holderNode = this.getOrCreateHolder(itemNode);
        let holder = holderNode.getComponent(ItemHolder);
        if (!holder) holder = holderNode.addComponent(ItemHolder);

        let holderUT = holderNode.getComponent(UITransform);
        if (!holderUT) holderUT = holderNode.addComponent(UITransform);
        holderUT.setContentSize(itemUT.contentSize);
        holderUT.setAnchorPoint(itemUT.anchorPoint);

        const currentScale = itemNode.scale.clone();
        itemSnap.baseScale = currentScale.clone();
        itemSnap.id = id;
        itemSnap.correctHolderTransform = holderNode;
        itemSnap.currentState = ItemState.Waiting;
        itemSnap.waitingPosition = itemNode.worldPosition.clone();
        if (sprite) itemSnap.spriteRenderer = sprite;
        holder.id = id;

        // Link shadow
        const shadowNode = shadows.get(itemNode.name) || this.findShadowOnHolder(holderNode, itemNode.name);
        if (shadowNode) {
            shadowNode.setParent(holderNode);
            shadowNode.setPosition(Vec3.ZERO);
            shadowNode.active = false;
            itemSnap.shadowOnHolder = shadowNode;

            const shadowSprite = shadowNode.getComponent(Sprite);
            if (shadowSprite) {
                shadowSprite.color = this.shadowColor;
            }
        }
    }

    /**
     * Removes holder nodes that do not correspond to any active item.
     */
    public RefreshHolderTargets(): void {
        if (!this.validateParents()) return;

        const validItemNames = new Set<string>();
        for (const child of this.itemsParent.children) {
            if (!this.isShadowName(child.name)) {
                validItemNames.add(this.holderPrefix + child.name);
            }
        }

        let removedCount = 0;
        const holders = [...this.holdersParent.children];
        for (const holder of holders) {
            if (holder.name.startsWith(this.holderPrefix) && !validItemNames.has(holder.name)) {
                holder.destroy();
                removedCount++;
            }
        }

        console.log(`✅ [ItemSetupTool] Refresh completed. Removed ${removedCount} unused holder(s).`);
    }

    /**
     * Creates shadow nodes for holders that lack one.
     */
    public CreateMissingTargetShadows(): void {
        if (!this.validateParents()) return;

        const itemsByName = new Map<string, ItemSnap>();
        for (const child of this.itemsParent.children) {
            if (this.isShadowName(child.name)) continue;
            const snap = child.getComponent(ItemSnap);
            if (snap) itemsByName.set(child.name, snap);
        }

        let createdCount = 0;
        for (const holder of this.holdersParent.children) {
            if (!holder.name.startsWith(this.holderPrefix)) continue;
            const itemName = holder.name.substring(this.holderPrefix.Length ?? this.holderPrefix.length);
            const itemSnap = itemsByName.get(itemName);
            if (!itemSnap) continue;

            let shadow = this.findShadowOnHolder(holder, itemName);
            if (!shadow) {
                shadow = this.createShadowNode(holder, itemName, itemSnap.spriteRenderer);
                itemSnap.shadowOnHolder = shadow;
                createdCount++;
            } else {
                itemSnap.shadowOnHolder = shadow;
            }
        }

        console.log(`✅ [ItemSetupTool] Created ${createdCount} missing target shadow(s).`);
    }

    /**
     * Sorts item nodes inside itemsParent by their ID ascending.
     */
    public SortItemsByOrder(): void {
        if (!this.itemsParent) return;

        const items = this.itemsParent.getComponentsInChildren(ItemSnap)
            .filter(item => item.node.parent === this.itemsParent && !this.isShadowName(item.node.name));

        items.sort((a, b) => a.id - b.id);

        for (let i = 0; i < items.length; i++) {
            items[i].node.setSiblingIndex(i);
        }

        console.log(`✅ [ItemSetupTool] Sorted ${items.length} item(s) in itemsParent by ID.`);
    }

    /**
     * Sets all shadow sprites to faded black.
     */
    public SetAllShadowsToFadedBlack(): void {
        const sprites: Sprite[] = [];
        if (this.itemsParent) sprites.push(...this.itemsParent.getComponentsInChildren(Sprite));
        if (this.holdersParent) sprites.push(...this.holdersParent.getComponentsInChildren(Sprite));

        let count = 0;
        for (const sp of sprites) {
            if (sp.node && this.isShadowName(sp.node.name)) {
                sp.color = this.shadowColor;
                count++;
            }
        }

        console.log(`✅ [ItemSetupTool] Set ${count} shadow sprite(s) to faded black.`);
    }

    /**
     * Extracts sprite to a child "Model" node for each item.
     */
    public ExtractSpriteToModel(): void {
        if (!this.itemsParent) return;

        const items = this.itemsParent.getComponentsInChildren(ItemSnap)
            .filter(item => item.node.parent === this.itemsParent);

        let count = 0;
        for (const item of items) {
            const itemNode = item.node;
            const originalSprite = itemNode.getComponent(Sprite);
            if (!originalSprite) continue;

            const originalScale = itemNode.scale.clone();
            item.baseScale = originalScale.clone();

            let modelNode = itemNode.getChildByName('Model');
            if (!modelNode) {
                modelNode = new Node('Model');
                modelNode.setParent(itemNode);
                modelNode.setPosition(Vec3.ZERO);
                modelNode.setRotationFromEuler(0, 0, 0);
                modelNode.setScale(Vec3.ONE);
            }

            let modelSprite = modelNode.getComponent(Sprite);
            if (!modelSprite) modelSprite = modelNode.addComponent(Sprite);

            modelSprite.spriteFrame = originalSprite.spriteFrame;
            modelSprite.color = originalSprite.color;
            modelSprite.type = originalSprite.type;

            const ut = originalSprite.getComponent(UITransform);
            const modelUT = modelNode.getComponent(UITransform) || modelNode.addComponent(UITransform);
            if (ut) {
                modelUT.setContentSize(ut.contentSize);
                modelUT.setAnchorPoint(ut.anchorPoint);
            }

            item.spriteRenderer = modelSprite;
            originalSprite.destroy();

            // Đảm bảo node cha giữ nguyên scale gốc của item
            itemNode.setScale(originalScale);
            count++;
        }

        console.log(`✅ [ItemSetupTool] Extracted sprite to Model for ${count} item(s). Preserved parent scale.`);
    }

    // ==================== HELPER METHODS ====================

    private getOrCreateHolder(itemNode: Node): Node {
        const holderName = this.holderPrefix + itemNode.name;
        let holderNode = this.holdersParent.getChildByName(holderName);

        if (!holderNode) {
            holderNode = new Node(holderName);
            holderNode.setParent(this.holdersParent);
        }

        holderNode.setWorldPosition(itemNode.worldPosition);
        holderNode.setWorldRotation(itemNode.worldRotation);
        holderNode.setScale(itemNode.scale.clone());
        return holderNode;
    }

    private createShadowNode(holder: Node, itemName: string, itemSprite: Sprite | null): Node {
        const shadowName = itemName + this.shadowSuffix;
        const shadowNode = new Node(shadowName);
        shadowNode.setParent(holder);
        shadowNode.setPosition(Vec3.ZERO);
        shadowNode.setScale(Vec3.ONE);

        const shadowUT = shadowNode.addComponent(UITransform);
        const shadowSprite = shadowNode.addComponent(Sprite);

        if (itemSprite) {
            shadowSprite.spriteFrame = itemSprite.spriteFrame;
            shadowSprite.color = this.shadowColor;
            const srcUT = itemSprite.getComponent(UITransform);
            if (srcUT) {
                shadowUT.setContentSize(srcUT.contentSize);
                shadowUT.setAnchorPoint(srcUT.anchorPoint);
            }
        }

        shadowNode.active = false;
        return shadowNode;
    }

    private findShadowOnHolder(holder: Node, itemName: string): Node | null {
        const shadowName = itemName + this.shadowSuffix;
        const exact = holder.getChildByName(shadowName);
        if (exact) return exact;

        for (const child of holder.children) {
            if (this.isShadowName(child.name)) return child;
        }
        return null;
    }

    private ensureHoldersParent(): void {
        if (this.holdersParent && this.holdersParent.isValid) return;

        let existing = this.node.getChildByName(this.holdersParentName);
        if (!existing && this.itemsParent?.parent) {
            existing = this.itemsParent.parent.getChildByName(this.holdersParentName);
        }
        if (!existing) {
            existing = new Node(this.holdersParentName);
            existing.setParent(this.itemsParent?.parent || this.node);
        }
        this.holdersParent = existing;
    }

    private collectShadows(): Map<string, Node> {
        const map = new Map<string, Node>();
        if (!this.itemsParent) return map;

        const allChildren = this.itemsParent.getComponentsInChildren(Sprite);
        for (let i = 0; i < allChildren.length; i++) {
            const node = allChildren[i].node;
            if (this.isShadowName(node.name)) {
                const itemName = this.getItemNameFromShadow(node.name);
                map.set(itemName, node);
            }
        }
        return map;
    }

    private validateParents(): boolean {
        if (!this.itemsParent || !this.itemsParent.isValid) {
            console.error('[ItemSetupTool] Please assign itemsParent.');
            return false;
        }
        if (!this.holdersParent || !this.holdersParent.isValid) {
            console.error('[ItemSetupTool] Please assign holdersParent.');
            return false;
        }
        return true;
    }

    private isShadowName(name: string): boolean {
        return name.toLowerCase().endsWith(this.shadowSuffix.toLowerCase());
    }

    private getItemNameFromShadow(shadowName: string): string {
        return shadowName.substring(0, shadowName.length - this.shadowSuffix.length);
    }
}
