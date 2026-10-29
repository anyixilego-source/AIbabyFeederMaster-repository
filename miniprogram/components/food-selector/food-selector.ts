import {cachedAiNutrition} from '../../utils/ai-nutrition';
import {familyState} from '../../utils/family-state';
import { ApiError, request } from '../../utils/api';
interface Food {
    foodId: string;
    selectedFoodRevisionId?: string | null;
    canonicalNameZh: string;
    foodForm: string | null;
    processingMethod: string | null;
    profile?: {
        displayName: string;
        distinctionTags: unknown;
    } | null;
    description?: string;
    nutritionSummary?: {numericNutrientCount:number;sourceVersions:string[]};
    infoText?:string;
}
const states: Record<string, string> = { RAW: '生', COOKED: '熟', BOILED: '煮', STEAMED: '蒸', FRIED: '炸', STIR_FRIED: '炒', BAKED: '烤', DRIED: '干制' };
function foodDescription(food: Food): string {
    const tags = Array.isArray(food.profile?.distinctionTags) ? food.profile!.distinctionTags.map(tag => {
        const text = String(tag);
        const legacy = text.match(/^已存处理方式[：:]\s*(.+)$/);
        return legacy ? states[legacy[1]!.trim().toUpperCase()] || '' : text;
    }) : [];
    return [...new Set([food.foodForm, states[(food.processingMethod || '').trim().toUpperCase()] || '', ...tags].filter(Boolean))].join(' · ');
}
Component({ properties: { visible: { type: Boolean, value: false }, initialQuery: { type: String, value: '' } }, data: { aiCandidate:null as {id:string;name:string}|null,sequence: 0, timer: null as ReturnType<typeof setTimeout> | null, query: '', items: [] as Food[], cursor: '', hasMore: false, loading: false, message: '', state: 'idle', detail: '', detailFoodId: '' },
    observers: { 'visible,initialQuery': function (visible: boolean, initialQuery: string) { ++this.data.sequence; if (this.data.timer)
            clearTimeout(this.data.timer); if (visible) {
            this.setData({ query: initialQuery,aiCandidate:null,items: [], cursor: '', hasMore: false, message: '', state: 'idle', loading: false, detail: '', detailFoodId: '' });
            if (initialQuery.trim())
                void this.search(false);
        } } },
    lifetimes: { detached() { ++this.data.sequence; if (this.data.timer)
            clearTimeout(this.data.timer); } },
    methods: {
        chooseAi(){const c=this.data.aiCandidate;if(c)this.triggerEvent('select',{food:{foodId:'',aiFoodNutritionId:c.id,canonicalNameZh:c.name,foodForm:null,processingMethod:null},unmatched:true,matchReason:'AI_ESTIMATE'})},
        noop() { }, close() { ++this.data.sequence; this.triggerEvent('close'); },
        input(e: WechatMiniprogram.Input) { ++this.data.sequence; this.setData({ query: e.detail.value, cursor: '', hasMore: false, loading: false, detail: '' }); if (this.data.timer)
            clearTimeout(this.data.timer); this.data.timer = setTimeout(() => { void this.search(false); }, 350); },
        submit() { void this.search(false); }, more() { void this.search(true); },
        async search(more: boolean) { const query = this.data.query.trim(); if (!query) {
            this.setData({ items: [], state: 'idle', message: '', loading: false });
            return;
        } if (more && (this.data.loading || !this.data.hasMore))
            return; const sequence = ++this.data.sequence; this.setData({ loading: true, message: '' }); try {
            const response = await request<{
                items: Food[];
                nextCursor: string | null;
                hasMore: boolean;
            }>('/foods/search?q=' + encodeURIComponent(query) + '&limit=15' + (more ? '&cursor=' + encodeURIComponent(this.data.cursor) : ''));
            if (sequence !== this.data.sequence || !this.data.visible)
                return;
            if(!more){let aiCandidate:{id:string;name:string}|null=null;const subject=familyState()?.subjectId;if(subject)try{const r=await cachedAiNutrition(subject,[{localId:'selector',observedName:query}]);if(r[0]?.aiFoodNutritionId)aiCandidate={id:r[0].aiFoodNutritionId,name:query}}catch{}if(sequence!==this.data.sequence||!this.data.visible)return;this.setData({aiCandidate});}
            const seen = new Set(more ? this.data.items.map(i => i.foodId) : []);
            const items = response.items.filter(i => !seen.has(i.foodId)).map(i => ({ ...i, description: foodDescription(i), infoText:i.nutritionSummary?'每100克可食部分 · '+i.nutritionSummary.numericNutrientCount+'项有数值资料'+(i.nutritionSummary.sourceVersions.length?' · 来源：'+i.nutritionSummary.sourceVersions.join('、'):''):'' }));
            this.setData({ items: more ? [...this.data.items, ...items] : items, cursor: response.nextCursor || '', hasMore: response.hasMore, state: items.length || more ? 'results' : 'empty', message: items.length || more ? '' : '没有找到标准食品；可按名称记录，营养资料暂缺。' });
        }
        catch (e) {
            if (sequence === this.data.sequence && this.data.visible && more && e instanceof ApiError
                && e.statusCode === 400 && (e.data as {code?: string} | null)?.code === 'FOOD_SEARCH_CURSOR_STALE') {
                this.setData({ items: [], cursor: '', hasMore: false, loading: false });
                await this.search(false);
                return;
            }
            if (sequence === this.data.sequence)
                this.setData({ state: 'error', message: e instanceof ApiError && e.statusCode === 429 ? '查询过于频繁，请稍候重试。' : e instanceof Error ? e.message : '查询未完成，请重试；仍可按名称记录。' });
        }
        finally {
            if (sequence === this.data.sequence)
                this.setData({ loading: false });
        } },
        choose(e: WechatMiniprogram.TouchEvent) { const food = this.data.items.find(i => i.foodId === String(e.currentTarget.dataset.id)); if (food)
            this.triggerEvent('select', { food, unmatched: false }); },
        byName() { const name = this.data.query.trim(); if (!name)
            return; this.triggerEvent('select', { food: { foodId: '', canonicalNameZh: name, foodForm: null, processingMethod: null }, unmatched: true, matchReason: this.data.state === 'error' || this.data.loading || this.data.state === 'idle' ? 'REQUEST_FAILED' : 'NO_MATCH_NO_NUTRITION' }); },
        async details(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id); if (this.data.detailFoodId === id) {
            this.setData({ detail: '', detailFoodId: '' });
            return;
        } const seq = this.data.sequence; try {
            const r = await request<{
                canonicalNameZh: string;
                nutrients: Array<{
                    valuePer100g: string | null;
                    status: string;
                    sourceVersion: string;
                }>;
            }>('/foods/' + id + '/nutrients');
            if (seq !== this.data.sequence || !this.data.visible)
                return;
            const count = r.nutrients.filter(n => n.valuePer100g !== null).length;
            this.setData({ detailFoodId: id, detail: r.canonicalNameZh + '；每100克可食部分，' + count + '项有数值资料。来源：' + [...new Set(r.nutrients.map(n => n.sourceVersion))].join('、') });
        }
        catch (e) {
            if (seq === this.data.sequence)
                this.setData({ detailFoodId: id, detail: e instanceof Error ? e.message : '食品资料暂不可用' });
        } }
    } });
