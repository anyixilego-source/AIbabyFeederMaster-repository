export interface FamilyContext {
  subjectId:string;householdId:string;displayName:string;birthDate:string;sex:string
  sharedVersion:string;role:'OWNER'|'CAREGIVER'|'VIEWER';canRecord:boolean;canManage:boolean
}
let active:FamilyContext|null=null
let generation=0
export function familyState(){return active}
export function familyGeneration(){return generation}
export function setFamilyState(next:FamilyContext|null){
  if(active?.subjectId!==next?.subjectId||active?.role!==next?.role)generation++
  active=next
}
export function canRecordBaby(){return active?.canRecord!==false}
export function canManageBaby(){return active?.canManage!==false}
export function invalidateFamilyState(){generation++;active=null}
