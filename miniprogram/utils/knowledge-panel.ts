// Presentation state only; claims and their evidence stay unchanged.
export function knowledgePanel<T>(claims:T[], expanded:boolean, sourcesVisible:boolean) {
  const showKnowledge = claims.length > 1 && (expanded || sourcesVisible)
  const showKnowledgeSources = claims.length > 0 && sourcesVisible
  return { showKnowledge, showKnowledgeSources, visibleKnowledge:showKnowledge ? claims : claims.slice(0,1) }
}

export function advanceKnowledgePanel<T>(claims:T[], expanded:boolean, sourcesVisible:boolean) {
  if (claims.length <= 1) return knowledgePanel(claims,false,!sourcesVisible)
  if (!expanded) return knowledgePanel(claims,true,false)
  if (!sourcesVisible) return knowledgePanel(claims,true,true)
  return knowledgePanel(claims,false,false)
}
