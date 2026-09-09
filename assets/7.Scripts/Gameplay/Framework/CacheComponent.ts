import { Component, Node } from 'cc';

export class ComponentCache {
    // Uses WeakMap instead of Map to prevent memory leaks when Nodes are destroyed.
    private static _caches: Map<Function, WeakMap<Node, Component>> = new Map();

    /**
     * Get component from cache or fetch via getComponent and cache it.
     * @param node Target Node
     * @param classConstructor Component class
     * @returns Component instance or null
     */
    public static get<T extends Component>(node: Node, classConstructor: { new(...args: any[]): T }): T | null {
        if (!node || !node.isValid) return null;

        let cache = this._caches.get(classConstructor);
        if (!cache) {
            cache = new WeakMap<Node, Component>();
            this._caches.set(classConstructor, cache);
        }

        if (!cache.has(node)) {
            let component = node.getComponent(classConstructor);
            if (component) {
                cache.set(node, component);
            }
            return component;
        }

        let cachedComponent = cache.get(node) as T;
        if (cachedComponent && cachedComponent.isValid) {
            return cachedComponent;
        } else {
            cache.delete(node);
            return null;
        }
    }

    public static clearCache() {
        this._caches.clear();
    }
}
