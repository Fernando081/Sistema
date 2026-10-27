import { Injectable } from '@angular/core';

// Transferencia efímera entre componentes: nunca usa URL, historial, cookie ni Web Storage.
@Injectable({providedIn:'root'})
export class MfaReceiptService {
  private codes:string[]=[];
  publish(codes:string[]):void{this.codes=[...codes];}
  take():string[]{const codes=this.codes;this.codes=[];return codes;}
}
