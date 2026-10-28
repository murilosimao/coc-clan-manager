export const tags=['2G8QCR92V','2CQ9CR2YP'],player='P0VUQRYVL';
export function fixture(clan=tags[1],end='20261020T000000.000Z',stars=[3,3]){
 const member=(tag,mapPosition)=>({tag:'#'+tag,name:tag===player?'CARLOSSTS':tag,townhallLevel:18,mapPosition,attacks:[]});
 const ours=[player,'PYL','PYQ','PYG','PYR'].map((t,i)=>member(t,i+1)),theirs=['GRL','GRQ','GRG','GRR','GRP'].map((t,i)=>member(t,i+1));
 ours[0].attacks=stars.map((s,i)=>({attackerTag:'#'+player,defenderTag:'#'+theirs[i].tag.slice(1),stars:s,destructionPercentage:100,order:i+1}));
 return {state:'warEnded',type:'random',teamSize:5,attacksPerMember:2,battleModifier:'none',startTime:'20261001T000000.000Z',endTime:end,
 clan:{tag:'#'+clan,name:clan===tags[0]?'PuroSangue':'SanguePuro',members:ours,attacks:stars.length},opponent:{tag:'#2998YJPU2',name:'Adversário',members:theirs,attacks:0}};
}
