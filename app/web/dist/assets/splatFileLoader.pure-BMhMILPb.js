import{b1 as oe,e as T,dE as J,gG as ge,al as le,L as E,cp as ue,G as U,av as $,f as _e,z as pe,V as F,X as xe,dm as ee,cd as X,l as re,r as Te,at as Le,a3 as qe,cH as Se,Q as Ae,fa as ke,gt as Fe,nf as De,bt as Pe,v as Be,h as Ee,bA as Oe}from"./index-BNNeZAnZ.js";import{S as ce}from"./quickCreateToolsService-DJkmu0fC-P1oSo0Fu.js";import"./index-hL65EcvJ.js";import{_ as ze}from"./tools.internals-DV8D-YoC.js";import"./flyCamera-BYHJvt4U.js";import"./pbrMaterial.pure-B0ao_F3q.js";import"./brdfTextureTools-9egm_F0O.js";import"./openpbrMaterial.pure-DyJOlW1V.js";import"./gaussianSplatting-BdzsmWna.js";import"./cubemapToSphericalPolynomial-DYQOOMlz.js";import"./proceduralTexture.pure-DpFr9MDv.js";import"./hdr-Dfiu4LkU.js";import"./animationGroup.pure-RAU7NFdv.js";import"./math.vector.functions-DOFcI3sd.js";import"./baseTexture.polynomial.pure-DoTmPMX4.js";import"./gaussianSplatting-DDHRw9Wu.js";import"./sceneUboDeclaration-Cc6aoBDm.js";import"./meshUboDeclaration-75wuZ4LK.js";import"./logDepthFragment-Cz20DVDC.js";import"./fogFragment-CfHoG4XH.js";import"./gaussianSplattingFragmentDeclaration-CxYfgXXX.js";import"./sceneUboDeclaration-Cc-bIRKN.js";import"./meshUboDeclaration-BbwfSCeV.js";import"./objectIdFunctions-3_S6PcDc.js";import"./logDepthFragment-DPAUSiDm.js";import"./imageProcessingFunctions-BlJ_ZY66.js";import"./logDepthDeclaration-B3dFxubp.js";import"./helperFunctions-SfZqZ-oO.js";import"./fogFragment-BmrukV4-.js";import"./clipPlaneFragment-kdiuNdGF.js";import"./geometryRenderingFragment-AotTVLCE.js";import"./fogVertex-BcFZBwHq.js";import"./clipPlaneVertex-BvNFQOjZ.js";import"./logDepthVertex-DFs9CD5d.js";const be=.28209479177387814;async function Z(g,e,t){return await new Promise((i,r)=>{const a=t.createCanvasImage();if(!a)throw new Error("Failed to create ImageBitmap");a.onload=()=>{try{const o=t.createCanvas(a.width,a.height);if(!o)throw new Error("Failed to create canvas");const l=o.getContext("2d");if(!l)throw new Error("Failed to get 2D context");l.drawImage(a,0,0);const u=l.getImageData(0,0,o.width,o.height);i({bits:new Uint8Array(u.data.buffer),width:u.width,height:u.height})}catch(o){r(`Error loading image ${a.src} with exception: ${o}`)}},a.onerror=o=>{r(`Error loading image ${a.src} with exception: ${o}`)},a.crossOrigin="anonymous";let n;if(typeof g=="string"){if(!e)throw new Error("filename is required when using a URL");a.src=g+e}else{const o=new Blob([g],{type:"image/webp"});n=URL.createObjectURL(o),a.src=n}})}async function Ie(g,e,t){const s=g.count?g.count:g.means.shape[0],i=32,r=new ArrayBuffer(i*s),a=new Float32Array(r),n=new Float32Array(r),o=new Uint8ClampedArray(r),l=new Uint8ClampedArray(r),u=f=>Math.sign(f)*(Math.exp(Math.abs(f))-1),d=e[0].bits,h=e[1].bits;if(!Array.isArray(g.means.mins)||!Array.isArray(g.means.maxs))throw new Error("Missing arrays in SOG data.");for(let f=0;f<s;f++){const x=f*4;for(let p=0;p<3;p++){const y=g.means.mins[p],M=g.means.maxs[p],_=h[x+p],b=d[x+p],w=_<<8|b,v=J.Lerp(y,M,w/65535);a[f*8+p]=u(v)}}const c=e[2].bits;if(g.version===2){if(!g.scales.codebook)throw new Error("Missing codebook in SOG version 2 scales data.");for(let f=0;f<s;f++){const x=f*4;for(let p=0;p<3;p++){const y=g.scales.codebook[c[x+p]],M=Math.exp(y);n[f*8+3+p]=M}}}else{if(!Array.isArray(g.scales.mins)||!Array.isArray(g.scales.maxs))throw new Error("Missing arrays in SOG scales data.");for(let f=0;f<s;f++){const x=f*4;for(let p=0;p<3;p++){const y=c[x+p],M=J.Lerp(g.scales.mins[p],g.scales.maxs[p],y/255),_=Math.exp(M);n[f*8+3+p]=_}}}const m=e[4].bits;if(g.version===2){if(!g.sh0.codebook)throw new Error("Missing codebook in SOG version 2 sh0 data.");for(let f=0;f<s;f++){const x=f*4;for(let p=0;p<3;p++){const y=.5+g.sh0.codebook[m[x+p]]*be;o[f*32+24+p]=Math.max(0,Math.min(255,Math.round(255*y)))}o[f*32+24+3]=m[x+3]}}else{if(!Array.isArray(g.sh0.mins)||!Array.isArray(g.sh0.maxs))throw new Error("Missing arrays in SOG sh0 data.");for(let f=0;f<s;f++){const x=f*4;for(let p=0;p<4;p++){const y=g.sh0.mins[p],M=g.sh0.maxs[p],_=m[x+p],b=J.Lerp(y,M,_/255);let w;p<3?w=.5+b*be:w=1/(1+Math.exp(-b)),o[f*32+24+p]=Math.max(0,Math.min(255,Math.round(255*w)))}}}const S=f=>(f/255-.5)*2/Math.SQRT2,C=e[3].bits;for(let f=0;f<s;f++){const x=C[f*4+0],p=C[f*4+1],y=C[f*4+2],M=C[f*4+3],_=S(x),b=S(p),w=S(y),v=M-252,D=_*_+b*b+w*w,L=Math.sqrt(Math.max(0,1-D));let q;switch(v){case 0:q=[L,_,b,w];break;case 1:q=[_,L,b,w];break;case 2:q=[_,b,L,w];break;case 3:q=[_,b,w,L];break;default:throw new Error("Invalid quaternion mode")}l[f*32+28+0]=q[0]*127.5+127.5,l[f*32+28+1]=q[1]*127.5+127.5,l[f*32+28+2]=q[2]*127.5+127.5,l[f*32+28+3]=q[3]*127.5+127.5}if(g.shN){const f=g.shN.bands?(g.shN.bands+1)**2-1:g.shN.shape[1]/3,x=g.shN.bands!==void 0&&g.shN.bands!==null?g.shN.bands:Math.round(Math.sqrt(f+1)-1),p=e[5].bits,y=e[6].bits,M=e[5].width,_=f*3,b=Math.ceil(_/16),v=t.getEngine().getCaps().maxTextureSize,D=Math.ceil(s/v),L=ge(b,D*v*4*4);if(g.version===2){if(!g.shN.codebook)throw new Error("Missing codebook in SOG version 2 shN data.");for(let q=0;q<s;q++){const P=y[q*4+0]+(y[q*4+1]<<8),R=P%64*f,A=Math.floor(P/64);for(let B=0;B<f;B++)for(let k=0;k<3;k++){const I=B*3+k,z=Math.floor(I/16),W=L[z],j=I%16,G=q*16,H=g.shN.codebook[p[(R+B)*4+k+A*M*4]]*127.5+127.5;W[j+G]=Math.max(0,Math.min(255,H))}}}else for(let q=0;q<s;q++){const P=y[q*4+0]+(y[q*4+1]<<8),R=P%64*f,A=Math.floor(P/64),B=g.shN.mins,k=g.shN.maxs;for(let I=0;I<3;I++)for(let z=0;z<f/3;z++){const W=z*3+I,j=Math.floor(W/16),G=L[j],H=W%16,V=q*16,K=J.Lerp(B,k,p[(R+z)*4+I+A*M*4]/255)*127.5+127.5;G[H+V]=Math.max(0,Math.min(255,K))}}return await new Promise(q=>{q({mode:0,data:r,hasVertexColors:!1,sh:L,shDegree:x})})}return await new Promise(f=>{f({mode:0,data:r,hasVertexColors:!1})})}async function We(g,e,t){let s,i;if(g instanceof Map){i=g;const n=i.get("meta.json");if(!n)throw new Error("meta.json not found in files Map");s=JSON.parse(new TextDecoder().decode(n))}else s=g;const r=[...s.means.files,...s.scales.files,...s.quats.files,...s.sh0.files];s.shN&&r.push(...s.shN.files);const a=await Promise.all(r.map(async n=>{if(i&&i.has(n)){const o=i.get(n);return await Z(o,n,t.getEngine())}else return await Z(e,n,t.getEngine())}));return await Ie(s,a,t)}function Ne(g,e,t,s){const i=new oe(e,t,s,T.TEXTUREFORMAT_RGBA,g,!1,!1,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURETYPE_UNSIGNED_BYTE,T.TEXTURE_CREATIONFLAG_SAMPLED_DATA_ONLY);return i.wrapU=T.TEXTURE_CLAMP_ADDRESSMODE,i.wrapV=T.TEXTURE_CLAMP_ADDRESSMODE,i}function me(g,e){return Ne(g,e.bits,e.width,e.height)}async function he(g,e,t){const s=t.getEngine();if(typeof createImageBitmap=="function")try{const r=e.toLowerCase().endsWith(".png")?"image/png":"image/webp";let a;if(typeof g=="string"){const o=await le.LoadFileAsync(g+e,!0);a=new Blob([o],{type:r})}else a=new Blob([g],{type:r});const n=await createImageBitmap(a,{premultiplyAlpha:"none",colorSpaceConversion:"none"});try{const o=new oe(null,n.width,n.height,T.TEXTUREFORMAT_RGBA,t,!1,!1,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURETYPE_UNSIGNED_BYTE);o.wrapU=T.TEXTURE_CLAMP_ADDRESSMODE,o.wrapV=T.TEXTURE_CLAMP_ADDRESSMODE;const l=o.getInternalTexture();return l&&s.updateDynamicTexture(l,n,!1,!1),o}finally{n.close()}}catch{}const i=await Z(g,e,s);return me(t,i)}function Ue(g,e,t,s){const i=a=>Math.sign(a)*(Math.exp(Math.abs(a))-1);if(!Array.isArray(g.means.mins)||!Array.isArray(g.means.maxs))throw new Error("Missing arrays in SOG data.");const r=new Float32Array(s*4);for(let a=0;a<s;a++){const n=a*4;for(let o=0;o<3;o++){const l=t[n+o]<<8|e[n+o],u=J.Lerp(g.means.mins[o],g.means.maxs[o],l/65535);r[a*4+o]=i(u)}r[a*4+3]=1}return r}async function ae(g,e,t,s=!0,i,r){let a,n;if(g instanceof Map){n=g;const R=n.get("meta.json");if(!R)throw new Error("meta.json not found in files Map");a=JSON.parse(new TextDecoder().decode(R))}else a=g;const o=async R=>{if(n&&n.has(R))return await Z(n.get(R),R,t.getEngine());if(i){const A=new Uint8Array(await i.loadFileAsync(e+R,r));return await Z(A,R,t.getEngine())}return await Z(e,R,t.getEngine())},l=async R=>{if(n&&n.has(R))return await he(n.get(R),R,t);if(i){const A=new Uint8Array(await i.loadFileAsync(e+R,r));return await he(A,R,t)}return await he(e,R,t)},u=[...a.scales.files,...a.quats.files,...a.sh0.files,...a.shN?.files??[]];let d,h,c,m,S=null,C;if(s){const[R,A]=await Promise.all([Promise.all(a.means.files.map(o)),Promise.all(u.map(l))]);S=[R[0],R[1]],C=A,d=me(t,R[0]),h=me(t,R[1]),c=R[0].width,m=R[0].height}else{const[R,A]=await Promise.all([Promise.all(a.means.files.map(l)),Promise.all(u.map(l))]);C=A,d=R[0],h=R[1];const B=d.getSize();c=B.width,m=B.height}const f=a.count??a.means.shape[0],x=c*m;if(x<f)throw new Error(`SOG texture contains ${x} texels, but metadata references ${f} splats.`);const p=C[0],y=C[1],M=C[2];let _,b,w=0,v=0;a.shN&&C.length>=5&&(_=C[3],b=C[4],w=a.shN.bands?(a.shN.bands+1)**2-1:a.shN.shape[1]/3,v=a.shN.bands??Math.round(Math.sqrt(w+1)-1));let D;if(a.version===2){const A=new Float32Array(768);a.scales.codebook&&A.set(a.scales.codebook.slice(0,256),0),a.sh0.codebook&&A.set(a.sh0.codebook.slice(0,256),256),a.shN?.codebook&&A.set(a.shN.codebook.slice(0,256),256*2),D=new oe(A,256*3,1,T.TEXTUREFORMAT_R,t,!1,!1,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURETYPE_FLOAT,T.TEXTURE_CREATIONFLAG_SAMPLED_DATA_ONLY),D.wrapU=T.TEXTURE_CLAMP_ADDRESSMODE,D.wrapV=T.TEXTURE_CLAMP_ADDRESSMODE}const L=a.means.mins,q=a.means.maxs,P={version:a.version===2?2:1,splatCount:f,shDegree:v,meansTextureL:d,meansTextureU:h,scalesTexture:p,quatsTexture:y,sh0Texture:M,shCentroidsTexture:_,shLabelsTexture:b,codebookTexture:D,meansMin:[L[0],L[1],L[2]],meansMax:[q[0],q[1],q[2]],scalesMin:Array.isArray(a.scales.mins)?[a.scales.mins[0],a.scales.mins[1],a.scales.mins[2]]:void 0,scalesMax:Array.isArray(a.scales.maxs)?[a.scales.maxs[0],a.scales.maxs[1],a.scales.maxs[2]]:void 0,sh0Min:Array.isArray(a.sh0.mins)?[a.sh0.mins[0],a.sh0.mins[1],a.sh0.mins[2],a.sh0.mins[3]]:void 0,sh0Max:Array.isArray(a.sh0.maxs)?[a.sh0.maxs[0],a.sh0.maxs[1],a.sh0.maxs[2],a.sh0.maxs[3]]:void 0,shnMin:typeof a.shN?.mins=="number"?a.shN.mins:void 0,shnMax:typeof a.shN?.maxs=="number"?a.shN.maxs:void 0,shCoeffCount:w,positions:S?Ue(a,S[0].bits,S[1].bits,f):new Float32Array(0)};return{mode:0,data:new ArrayBuffer(0),hasVertexColors:!1,shDegree:v,sogTextures:P}}const Q=`precision highp float;
attribute vec3 position;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,Ge=`precision highp float;
precision highp int;

uniform sampler2D sogMeansLTex;
uniform sampler2D sogMeansUTex;
uniform sampler2D sogScalesTex;
uniform sampler2D sogQuatsTex;
uniform sampler2D sogSh0Tex;
uniform sampler2D sogCodebookTex;

uniform vec3 sogMeansMin;
uniform vec3 sogMeansMax;
uniform vec3 sogScalesMin;
uniform vec3 sogScalesMax;
uniform vec4 sogSh0Min;
uniform vec4 sogSh0Max;
uniform int uVersion;
uniform int uOffset;
uniform int uSourceOffset;
uniform int uCount;
uniform int uDestWidth;
uniform int uSrcWidth;

layout(location = 0) out vec4 glFragData[4];

mat3 transposeM(mat3 m) {
    return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);
}

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int global = p.y * uDestWidth + p.x;
    if (global < uOffset || global >= uOffset + uCount) {
        discard;
    }
    int k = global - uOffset + uSourceOffset;
    ivec2 src = ivec2(k - (k / uSrcWidth) * uSrcWidth, k / uSrcWidth);

    vec3 mL = texelFetch(sogMeansLTex, src, 0).xyz;
    vec3 mU = texelFetch(sogMeansUTex, src, 0).xyz;
    vec3 sRaw = texelFetch(sogScalesTex, src, 0).xyz;
    vec4 qRaw = texelFetch(sogQuatsTex, src, 0);
    vec4 c0 = texelFetch(sogSh0Tex, src, 0);

    // Position: q16 = (u<<8)|l normalized; n = lerp(min,max,q16); pos = sign(n)*(exp(|n|)-1)
    vec3 q16 = (mU * 256.0 + mL) * (255.0 / 65535.0);
    vec3 nPos = mix(sogMeansMin, sogMeansMax, q16);
    vec3 center = sign(nPos) * (exp(abs(nPos)) - vec3(1.0));

    // Scale (v1: lerp+exp ; v2: codebook lookup)
    vec3 splatScale;
    if (uVersion == 2) {
        vec3 sIdx = floor(sRaw * 255.0 + 0.5);
        splatScale.x = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.x), 0), 0).r);
        splatScale.y = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.y), 0), 0).r);
        splatScale.z = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.z), 0), 0).r);
    } else {
        splatScale = exp(mix(sogScalesMin, sogScalesMax, sRaw));
    }

    // Quaternion (largest-omitted, mode in alpha as 252 + omitted-index)
    const float invSqrt2 = 0.70710678118;
    vec3 qabc = (qRaw.xyz - vec3(0.5)) * 2.0 * invSqrt2;
    int qMode = int(qRaw.w * 255.0 + 0.5) - 252;
    float qd = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));
    vec4 quat;
    if (qMode == 0) {
        quat = vec4(qd, qabc.x, qabc.y, qabc.z);
    } else if (qMode == 1) {
        quat = vec4(qabc.x, qd, qabc.y, qabc.z);
    } else if (qMode == 2) {
        quat = vec4(qabc.x, qabc.y, qd, qabc.z);
    } else {
        quat = vec4(qabc.x, qabc.y, qabc.z, qd);
    }

    float qw = quat.x, qx = quat.y, qy = quat.z, qz = quat.w;
    mat3 R = mat3(
        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),
        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),
        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)
    );
    mat3 S2 = mat3(
        4.0 * splatScale.x * splatScale.x, 0.0, 0.0,
        0.0, 4.0 * splatScale.y * splatScale.y, 0.0,
        0.0, 0.0, 4.0 * splatScale.z * splatScale.z
    );
    mat3 Sigma = R * S2 * transposeM(R);

    // Color (sh0)
    const float SH_C0 = 0.28209479177387814;
    vec3 colRgb;
    float colA;
    if (uVersion == 2) {
        vec3 c3;
        c3.x = texelFetch(sogCodebookTex, ivec2(256 + int(c0.x * 255.0 + 0.5), 0), 0).r;
        c3.y = texelFetch(sogCodebookTex, ivec2(256 + int(c0.y * 255.0 + 0.5), 0), 0).r;
        c3.z = texelFetch(sogCodebookTex, ivec2(256 + int(c0.z * 255.0 + 0.5), 0), 0).r;
        colRgb = vec3(0.5) + c3 * SH_C0;
        colA = c0.w;
    } else {
        vec4 cLerp = mix(sogSh0Min, sogSh0Max, c0);
        colRgb = vec3(0.5) + cLerp.xyz * SH_C0;
        colA = 1.0 / (1.0 + exp(-cLerp.w));
    }

    glFragData[0] = vec4(center, 1.0);
    glFragData[1] = vec4(Sigma[0][0], Sigma[0][1], Sigma[0][2], Sigma[1][1]);
    glFragData[2] = vec4(Sigma[1][2], Sigma[2][2], 0.0, 0.0);
    glFragData[3] = vec4(colRgb, colA);
}
`,Y=`
attribute position : vec3<f32>;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {
    vertexOutputs.position = vec4<f32>(input.position.xy, 0.0, 1.0);
}
`,Ve=`
var sogMeansLTexSampler : sampler;
var sogMeansLTex : texture_2d<f32>;
var sogMeansUTexSampler : sampler;
var sogMeansUTex : texture_2d<f32>;
var sogScalesTexSampler : sampler;
var sogScalesTex : texture_2d<f32>;
var sogQuatsTexSampler : sampler;
var sogQuatsTex : texture_2d<f32>;
var sogSh0TexSampler : sampler;
var sogSh0Tex : texture_2d<f32>;
var sogCodebookTexSampler : sampler;
var sogCodebookTex : texture_2d<f32>;

uniform sogMeansMin : vec3<f32>;
uniform sogMeansMax : vec3<f32>;
uniform sogScalesMin : vec3<f32>;
uniform sogScalesMax : vec3<f32>;
uniform sogSh0Min : vec4<f32>;
uniform sogSh0Max : vec4<f32>;
uniform uVersion : i32;
uniform uOffset : i32;
uniform uSourceOffset : i32;
uniform uCount : i32;
uniform uDestWidth : i32;
uniform uSrcWidth : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    let global : i32 = p.y * uniforms.uDestWidth + p.x;
    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {
        discard;
    }
    let k : i32 = global - uniforms.uOffset + uniforms.uSourceOffset;
    let src : vec2<i32> = vec2<i32>(k - (k / uniforms.uSrcWidth) * uniforms.uSrcWidth, k / uniforms.uSrcWidth);

    let mL : vec3<f32> = textureLoad(sogMeansLTex, src, 0).xyz;
    let mU : vec3<f32> = textureLoad(sogMeansUTex, src, 0).xyz;
    let sRaw : vec3<f32> = textureLoad(sogScalesTex, src, 0).xyz;
    let qRaw : vec4<f32> = textureLoad(sogQuatsTex, src, 0);
    let c0 : vec4<f32> = textureLoad(sogSh0Tex, src, 0);

    let q16 : vec3<f32> = (mU * 256.0 + mL) * (255.0 / 65535.0);
    let nPos : vec3<f32> = mix(uniforms.sogMeansMin, uniforms.sogMeansMax, q16);
    let center : vec3<f32> = sign(nPos) * (exp(abs(nPos)) - vec3<f32>(1.0));

    var splatScale : vec3<f32>;
    if (uniforms.uVersion == 2) {
        let sIdx : vec3<f32> = floor(sRaw * 255.0 + 0.5);
        splatScale.x = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.x), 0), 0).r);
        splatScale.y = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.y), 0), 0).r);
        splatScale.z = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.z), 0), 0).r);
    } else {
        splatScale = exp(mix(uniforms.sogScalesMin, uniforms.sogScalesMax, sRaw));
    }

    let invSqrt2 : f32 = 0.70710678118;
    let qabc : vec3<f32> = (qRaw.xyz - vec3<f32>(0.5)) * 2.0 * invSqrt2;
    let qMode : i32 = i32(qRaw.w * 255.0 + 0.5) - 252;
    let qd : f32 = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));
    var quat : vec4<f32>;
    if (qMode == 0) {
        quat = vec4<f32>(qd, qabc.x, qabc.y, qabc.z);
    } else if (qMode == 1) {
        quat = vec4<f32>(qabc.x, qd, qabc.y, qabc.z);
    } else if (qMode == 2) {
        quat = vec4<f32>(qabc.x, qabc.y, qd, qabc.z);
    } else {
        quat = vec4<f32>(qabc.x, qabc.y, qabc.z, qd);
    }

    let qw : f32 = quat.x;
    let qx : f32 = quat.y;
    let qy : f32 = quat.z;
    let qz : f32 = quat.w;
    let R : mat3x3<f32> = mat3x3<f32>(
        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),
        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),
        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)
    );
    let S2 : mat3x3<f32> = mat3x3<f32>(
        4.0 * splatScale.x * splatScale.x, 0.0, 0.0,
        0.0, 4.0 * splatScale.y * splatScale.y, 0.0,
        0.0, 0.0, 4.0 * splatScale.z * splatScale.z
    );
    let Sigma : mat3x3<f32> = R * S2 * transpose(R);

    let SH_C0 : f32 = 0.28209479177387814;
    var colRgb : vec3<f32>;
    var colA : f32;
    if (uniforms.uVersion == 2) {
        var c3 : vec3<f32>;
        c3.x = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.x * 255.0 + 0.5), 0), 0).r;
        c3.y = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.y * 255.0 + 0.5), 0), 0).r;
        c3.z = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.z * 255.0 + 0.5), 0), 0).r;
        colRgb = vec3<f32>(0.5) + c3 * SH_C0;
        colA = c0.w;
    } else {
        let cLerp : vec4<f32> = mix(uniforms.sogSh0Min, uniforms.sogSh0Max, c0);
        colRgb = vec3<f32>(0.5) + cLerp.xyz * SH_C0;
        colA = 1.0 / (1.0 + exp(-cLerp.w));
    }

    fragmentOutputs.fragData0 = vec4<f32>(center, 1.0);
    fragmentOutputs.fragData1 = vec4<f32>(Sigma[0][0], Sigma[0][1], Sigma[0][2], Sigma[1][1]);
    fragmentOutputs.fragData2 = vec4<f32>(Sigma[1][2], Sigma[2][2], 0.0, 0.0);
    fragmentOutputs.fragData3 = vec4<f32>(colRgb, colA);
}
`,je="gsSogRotDecodeToWorkBuffer",He=`precision highp float;
precision highp int;

uniform sampler2D sogScalesTex;
uniform sampler2D sogQuatsTex;
uniform sampler2D sogCodebookTex;

uniform vec3 sogScalesMin;
uniform vec3 sogScalesMax;
uniform int uVersion;
uniform int uOffset;
uniform int uSourceOffset;
uniform int uCount;
uniform int uDestWidth;
uniform int uSrcWidth;

layout(location = 0) out vec4 glFragData[3];

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int global = p.y * uDestWidth + p.x;
    if (global < uOffset || global >= uOffset + uCount) {
        discard;
    }
    int k = global - uOffset + uSourceOffset;
    ivec2 src = ivec2(k - (k / uSrcWidth) * uSrcWidth, k / uSrcWidth);

    vec3 sRaw = texelFetch(sogScalesTex, src, 0).xyz;
    vec4 qRaw = texelFetch(sogQuatsTex, src, 0);

    vec3 splatScale;
    if (uVersion == 2) {
        vec3 sIdx = floor(sRaw * 255.0 + 0.5);
        splatScale.x = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.x), 0), 0).r);
        splatScale.y = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.y), 0), 0).r);
        splatScale.z = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.z), 0), 0).r);
    } else {
        splatScale = exp(mix(sogScalesMin, sogScalesMax, sRaw));
    }

    const float invSqrt2 = 0.70710678118;
    vec3 qabc = (qRaw.xyz - vec3(0.5)) * 2.0 * invSqrt2;
    int qMode = int(qRaw.w * 255.0 + 0.5) - 252;
    float qd = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));
    vec4 quat;
    if (qMode == 0) {
        quat = vec4(qd, qabc.x, qabc.y, qabc.z);
    } else if (qMode == 1) {
        quat = vec4(qabc.x, qd, qabc.y, qabc.z);
    } else if (qMode == 2) {
        quat = vec4(qabc.x, qabc.y, qd, qabc.z);
    } else {
        quat = vec4(qabc.x, qabc.y, qabc.z, qd);
    }

    float qw = quat.x, qx = quat.y, qy = quat.z, qz = quat.w;
    mat3 R = mat3(
        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),
        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),
        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)
    );

    glFragData[0] = vec4(R[0], R[1].x);
    glFragData[1] = vec4(R[1].y, R[1].z, R[2].x, R[2].y);
    glFragData[2] = vec4(R[2].z, 2.0 * splatScale.x, 2.0 * splatScale.y, 2.0 * splatScale.z);
}
`,$e=`
var sogScalesTexSampler : sampler;
var sogScalesTex : texture_2d<f32>;
var sogQuatsTexSampler : sampler;
var sogQuatsTex : texture_2d<f32>;
var sogCodebookTexSampler : sampler;
var sogCodebookTex : texture_2d<f32>;

uniform sogScalesMin : vec3<f32>;
uniform sogScalesMax : vec3<f32>;
uniform uVersion : i32;
uniform uOffset : i32;
uniform uSourceOffset : i32;
uniform uCount : i32;
uniform uDestWidth : i32;
uniform uSrcWidth : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    let global : i32 = p.y * uniforms.uDestWidth + p.x;
    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {
        discard;
    }
    let k : i32 = global - uniforms.uOffset + uniforms.uSourceOffset;
    let src : vec2<i32> = vec2<i32>(k - (k / uniforms.uSrcWidth) * uniforms.uSrcWidth, k / uniforms.uSrcWidth);

    let sRaw : vec3<f32> = textureLoad(sogScalesTex, src, 0).xyz;
    let qRaw : vec4<f32> = textureLoad(sogQuatsTex, src, 0);

    var splatScale : vec3<f32>;
    if (uniforms.uVersion == 2) {
        let sIdx : vec3<f32> = floor(sRaw * 255.0 + 0.5);
        splatScale.x = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.x), 0), 0).r);
        splatScale.y = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.y), 0), 0).r);
        splatScale.z = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.z), 0), 0).r);
    } else {
        splatScale = exp(mix(uniforms.sogScalesMin, uniforms.sogScalesMax, sRaw));
    }

    let invSqrt2 : f32 = 0.70710678118;
    let qabc : vec3<f32> = (qRaw.xyz - vec3<f32>(0.5)) * 2.0 * invSqrt2;
    let qMode : i32 = i32(qRaw.w * 255.0 + 0.5) - 252;
    let qd : f32 = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));
    var quat : vec4<f32>;
    if (qMode == 0) {
        quat = vec4<f32>(qd, qabc.x, qabc.y, qabc.z);
    } else if (qMode == 1) {
        quat = vec4<f32>(qabc.x, qd, qabc.y, qabc.z);
    } else if (qMode == 2) {
        quat = vec4<f32>(qabc.x, qabc.y, qd, qabc.z);
    } else {
        quat = vec4<f32>(qabc.x, qabc.y, qabc.z, qd);
    }

    let qw : f32 = quat.x;
    let qx : f32 = quat.y;
    let qy : f32 = quat.z;
    let qz : f32 = quat.w;
    let R : mat3x3<f32> = mat3x3<f32>(
        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),
        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),
        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)
    );

    fragmentOutputs.fragData0 = vec4<f32>(R[0], R[1].x);
    fragmentOutputs.fragData1 = vec4<f32>(R[1].y, R[1].z, R[2].x, R[2].y);
    fragmentOutputs.fragData2 = vec4<f32>(R[2].z, 2.0 * splatScale.x, 2.0 * splatScale.y, 2.0 * splatScale.z);
}
`,Xe="gsSogShDecodeToWorkBuffer",Qe=`precision highp float;
precision highp int;

uniform sampler2D sogShLabelsTex;
uniform sampler2D sogShCentroidsTex;
uniform sampler2D sogCodebookTex;
uniform float sogShnMin;
uniform float sogShnMax;
uniform int uVersion;
uniform int uOffset;
uniform int uSourceOffset;
uniform int uCount;
uniform int uDestWidth;
uniform int uSrcWidth;
uniform int uCoeffs;
uniform int uShTextureIndex;

layout(location = 0) out uvec4 outSh;

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int global = p.y * uDestWidth + p.x;
    if (global < uOffset || global >= uOffset + uCount) {
        discard;
    }
    int kLocal = global - uOffset + uSourceOffset;

    // 16-bit label for this source splat (LSB in r, MSB in g), indexed over the labels texture's own width.
    ivec2 lsz = textureSize(sogShLabelsTex, 0);
    ivec2 lsrc = ivec2(kLocal - (kLocal / lsz.x) * lsz.x, kLocal / lsz.x);
    vec4 labelRaw = texelFetch(sogShLabelsTex, lsrc, 0);
    int n = int(labelRaw.r * 255.0 + 0.5) + int(labelRaw.g * 255.0 + 0.5) * 256;
    int u = (n - (n / 64) * 64) * uCoeffs;
    int v = n / 64;

    uint packed0 = 0u;
    uint packed1 = 0u;
    uint packed2 = 0u;
    uint packed3 = 0u;

    for (int b = 0; b < 16; b++) {
        int s = uShTextureIndex * 16 + b; // flat SH scalar index
        int kc = s / 3;                    // higher-order coefficient (0-based)
        int j = s - kc * 3;                // channel (0=r,1=g,2=b)
        float byteVal = 128.0;             // neutral (decompose(128) ~= 0)
        if (kc < uCoeffs) {
            vec4 centroidRaw = texelFetch(sogShCentroidsTex, ivec2(u + kc, v), 0);
            float ch = (j == 0) ? centroidRaw.r : ((j == 1) ? centroidRaw.g : centroidRaw.b);
            float coeff;
            if (uVersion == 2) {
                int cidx = int(ch * 255.0 + 0.5);
                coeff = texelFetch(sogCodebookTex, ivec2(512 + cidx, 0), 0).r;
            } else {
                coeff = mix(sogShnMin, sogShnMax, ch);
            }
            byteVal = clamp(coeff * 127.5 + 127.5, 0.0, 255.0);
        }
        uint bv = uint(byteVal + 0.5);
        int comp = b / 4;
        uint contrib = bv << uint((b - comp * 4) * 8);
        if (comp == 0) { packed0 |= contrib; }
        else if (comp == 1) { packed1 |= contrib; }
        else if (comp == 2) { packed2 |= contrib; }
        else { packed3 |= contrib; }
    }
    outSh = uvec4(packed0, packed1, packed2, packed3);
}
`,Ye=`
var sogShLabelsTexSampler : sampler;
var sogShLabelsTex : texture_2d<f32>;
var sogShCentroidsTexSampler : sampler;
var sogShCentroidsTex : texture_2d<f32>;
var sogCodebookTexSampler : sampler;
var sogCodebookTex : texture_2d<f32>;

uniform sogShnMin : f32;
uniform sogShnMax : f32;
uniform uVersion : i32;
uniform uOffset : i32;
uniform uSourceOffset : i32;
uniform uCount : i32;
uniform uDestWidth : i32;
uniform uSrcWidth : i32;
uniform uCoeffs : i32;
uniform uShTextureIndex : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    let global : i32 = p.y * uniforms.uDestWidth + p.x;
    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {
        discard;
    }
    let kLocal : i32 = global - uniforms.uOffset + uniforms.uSourceOffset;

    let lsz : vec2<i32> = vec2<i32>(textureDimensions(sogShLabelsTex, 0));
    let lsrc : vec2<i32> = vec2<i32>(kLocal - (kLocal / lsz.x) * lsz.x, kLocal / lsz.x);
    let labelRaw : vec4<f32> = textureLoad(sogShLabelsTex, lsrc, 0);
    let n : i32 = i32(labelRaw.r * 255.0 + 0.5) + i32(labelRaw.g * 255.0 + 0.5) * 256;
    let u : i32 = (n - (n / 64) * 64) * uniforms.uCoeffs;
    let v : i32 = n / 64;

    var packed : array<u32, 4> = array<u32, 4>(0u, 0u, 0u, 0u);

    for (var b : i32 = 0; b < 16; b = b + 1) {
        let s : i32 = uniforms.uShTextureIndex * 16 + b;
        let kc : i32 = s / 3;
        let j : i32 = s - kc * 3;
        var byteVal : f32 = 128.0;
        if (kc < uniforms.uCoeffs) {
            let centroidRaw : vec4<f32> = textureLoad(sogShCentroidsTex, vec2<i32>(u + kc, v), 0);
            var ch : f32 = centroidRaw.b;
            if (j == 0) { ch = centroidRaw.r; } else if (j == 1) { ch = centroidRaw.g; }
            var coeff : f32;
            if (uniforms.uVersion == 2) {
                let cidx : i32 = i32(ch * 255.0 + 0.5);
                coeff = textureLoad(sogCodebookTex, vec2<i32>(512 + cidx, 0), 0).r;
            } else {
                coeff = mix(uniforms.sogShnMin, uniforms.sogShnMax, ch);
            }
            byteVal = clamp(coeff * 127.5 + 127.5, 0.0, 255.0);
        }
        let bv : u32 = u32(byteVal + 0.5);
        let comp : i32 = b / 4;
        packed[comp] = packed[comp] | (bv << u32((b - comp * 4) * 8));
    }
    fragmentOutputs.fragData0 = vec4<u32>(packed[0], packed[1], packed[2], packed[3]);
}
`,Je="gsWorkBufferRelayout",Ze=`precision highp float;
precision highp int;

uniform sampler2D uMapTex;
uniform sampler2D uSrc0;
uniform sampler2D uSrc1;
uniform sampler2D uSrc2;
uniform sampler2D uSrc3;
uniform int uDstWidth;
uniform int uSrcWidth;
uniform int uUseMap;
// Region-scoped relayout (hosted compound atlas), both default 0 (standalone square path unchanged):
//   uSrcBaseOffset — added to the map's (region-local) source index so pass 1 reads the correct GLOBAL atlas texel.
//   uDstBaseRow    — subtracted from the atlas destination row so pass 2's identity copy reads the region-local temp.
uniform int uSrcBaseOffset;
uniform int uDstBaseRow;

layout(location = 0) out vec4 glFragData[4];

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int srcIdx;
    if (uUseMap == 1) {
        float m = texelFetch(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uSrcBaseOffset + int(m + 0.5);
    } else {
        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;
    }
    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);
    glFragData[0] = texelFetch(uSrc0, s, 0);
    glFragData[1] = texelFetch(uSrc1, s, 0);
    glFragData[2] = texelFetch(uSrc2, s, 0);
    glFragData[3] = texelFetch(uSrc3, s, 0);
}
`,Ke="gsWorkBufferShCopy",et=`precision highp float;
precision highp int;
precision highp usampler2D;

uniform sampler2D uMapTex;
uniform usampler2D uSrcSh;
uniform int uDstWidth;
uniform int uSrcWidth;
uniform int uUseMap;
uniform int uSrcBaseOffset;
uniform int uDstBaseRow;

layout(location = 0) out uvec4 outSh;

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int srcIdx;
    if (uUseMap == 1) {
        float m = texelFetch(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uSrcBaseOffset + int(m + 0.5);
    } else {
        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;
    }
    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);
    outSh = texelFetch(uSrcSh, s, 0);
}
`,tt=`
var uMapTexSampler : sampler;
var uMapTex : texture_2d<f32>;
// Integer source sampled via textureLoad only — NO paired sampler (a sampler on a Uint texture fails WebGPU
// validation: "None of the supported sample types (Uint)"). Mirrors the draw shader's shTexture0 declaration.
var uSrcSh : texture_2d<u32>;

uniform uDstWidth : i32;
uniform uSrcWidth : i32;
uniform uUseMap : i32;
uniform uSrcBaseOffset : i32;
uniform uDstBaseRow : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    var srcIdx : i32;
    if (uniforms.uUseMap == 1) {
        let m : f32 = textureLoad(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);
    } else {
        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;
    }
    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);
    // Wrap in an explicit vec4<u32> so the WGSL processor emits an integer fragData location (its detection keys
    // off a literal vec4<u32>/vec4u in the assignment; a bare textureLoad(...) would default to vec4<f32>).
    fragmentOutputs.fragData0 = vec4<u32>(textureLoad(uSrcSh, s, 0));
}
`,st="gsWorkBufferRotCopy",it=`precision highp float;
precision highp int;

uniform sampler2D uMapTex;
uniform sampler2D uSrc0;
uniform sampler2D uSrc1;
uniform sampler2D uSrc2;
uniform int uDstWidth;
uniform int uSrcWidth;
uniform int uUseMap;
uniform int uSrcBaseOffset;
uniform int uDstBaseRow;

layout(location = 0) out vec4 glFragData[3];

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int srcIdx;
    if (uUseMap == 1) {
        float m = texelFetch(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uSrcBaseOffset + int(m + 0.5);
    } else {
        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;
    }
    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);
    glFragData[0] = texelFetch(uSrc0, s, 0);
    glFragData[1] = texelFetch(uSrc1, s, 0);
    glFragData[2] = texelFetch(uSrc2, s, 0);
}
`,rt=`
var uMapTexSampler : sampler;
var uMapTex : texture_2d<f32>;
var uSrc0Sampler : sampler;
var uSrc0 : texture_2d<f32>;
var uSrc1Sampler : sampler;
var uSrc1 : texture_2d<f32>;
var uSrc2Sampler : sampler;
var uSrc2 : texture_2d<f32>;

uniform uDstWidth : i32;
uniform uSrcWidth : i32;
uniform uUseMap : i32;
uniform uSrcBaseOffset : i32;
uniform uDstBaseRow : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    var srcIdx : i32;
    if (uniforms.uUseMap == 1) {
        let m : f32 = textureLoad(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);
    } else {
        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;
    }
    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);
    fragmentOutputs.fragData0 = textureLoad(uSrc0, s, 0);
    fragmentOutputs.fragData1 = textureLoad(uSrc1, s, 0);
    fragmentOutputs.fragData2 = textureLoad(uSrc2, s, 0);
}
`,at=`
var uMapTexSampler : sampler;
var uMapTex : texture_2d<f32>;
var uSrc0Sampler : sampler;
var uSrc0 : texture_2d<f32>;
var uSrc1Sampler : sampler;
var uSrc1 : texture_2d<f32>;
var uSrc2Sampler : sampler;
var uSrc2 : texture_2d<f32>;
var uSrc3Sampler : sampler;
var uSrc3 : texture_2d<f32>;

uniform uDstWidth : i32;
uniform uSrcWidth : i32;
uniform uUseMap : i32;
// Region-scoped relayout (hosted compound atlas), both default 0 (standalone square path unchanged).
uniform uSrcBaseOffset : i32;
uniform uDstBaseRow : i32;

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));
    var srcIdx : i32;
    if (uniforms.uUseMap == 1) {
        let m : f32 = textureLoad(uMapTex, p, 0).r;
        if (m < 0.0) {
            discard;
        }
        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);
    } else {
        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;
    }
    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);
    fragmentOutputs.fragData0 = textureLoad(uSrc0, s, 0);
    fragmentOutputs.fragData1 = textureLoad(uSrc1, s, 0);
    fragmentOutputs.fragData2 = textureLoad(uSrc2, s, 0);
    fragmentOutputs.fragData3 = textureLoad(uSrc3, s, 0);
}
`;class ye{get supportsAsyncCentersReadback(){const e=this._scene.getEngine();if(e.isWebGPU)return!0;const t=e;return!!t._gl&&typeof t._readPixelsAsync=="function"&&(t.webGLVersion??0)>=2}get textureSize(){return this._textureSize}get textures(){return this._mrt.textures}get shTextures(){return this._shMrts.map(e=>e.textures[0])}get rotationTextures(){return this._rotMrt?this._rotMrt.textures:[]}constructor(e,t,s,i,r){if(this._copyMaterial=null,this._relayoutMapData=null,this._relayoutMapTexture=null,this._backupMrt=null,this._disposed=!1,this._readFbo=null,this._shMrts=[],this._ownsShMrts=!1,this._shMaterial=null,this._shCopyMaterial=null,this._backupShMrts=null,this._rotMrt=null,this._ownsRotMrt=!1,this._rotMaterial=null,this._rotCopyMaterial=null,this._backupRotMrt=null,this._scene=e,this._shaderLanguage=e.getEngine().isWebGPU?1:0,this._capacity=Math.max(1,t),s?(this._mrt=s.mrt,this._textureSize=s.width,this._baseOffset=s.baseOffset,this._ownsMrt=!1):(this._textureSize=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,t)))),this._baseOffset=0,this._ownsMrt=!0,this._mrt=this._createMrt("gsWorkBuffer",!0)),i&&i.textureCount>0){if(i.externalMrts)this._shMrts=i.externalMrts.slice(0,i.textureCount),this._ownsShMrts=!1;else{for(let a=0;a<i.textureCount;a++)this._shMrts.push(this._createShMrt(`gsWorkBufferSh${a}`,!0));this._ownsShMrts=!0}this._shMaterial=this._createShMaterial()}r&&(r.externalMrt?(this._rotMrt=r.externalMrt,this._ownsRotMrt=!1):(this._rotMrt=this._createRotMrt("gsWorkBufferRot",!0),this._ownsRotMrt=!0),this._rotMaterial=this._createRotMaterial()),this._material=this._createMaterial(),this._quad=this._createQuad(),this._quad.material=this._material,this._ownsMrt||this.isRelayoutReady()}rebindAtlas(e){this._ownsMrt||(this._mrt=e)}rebindShAtlas(e){!this._ownsShMrts&&e&&this._shMrts.length&&(this._shMrts=e.slice(0,this._shMrts.length))}rebindRotAtlas(e){!this._ownsRotMrt&&e&&this._rotMrt&&(this._rotMrt=e)}setBaseOffset(e){this._ownsMrt||(this._baseOffset=e)}get canBackup(){return this._disposed||this._ownsMrt?!1:this.isRelayoutReady()}backupRegion(){if(this._disposed||this._ownsMrt)return;if(!this.isRelayoutReady()){E.Warn("GaussianSplattingWorkBuffer: backup skipped because the copy shaders are not ready; streamed region data may be lost on the atlas rebuild.");return}const e=this._textureSize,t=Math.max(1,Math.floor(this._capacity/e)),s=Math.floor(this._baseOffset/e);if(this._backupMrt||(this._backupMrt=this._createMrt("gsAtlasBackup",!1,e,t)),this._renderRelayoutPass(this._backupMrt,this._mrt.textures,this._mrt.textures[0],0,e,e,0,-s),this._shMrts.length&&this._shCopyMaterial){this._backupShMrts||(this._backupShMrts=this._shMrts.map((i,r)=>this._createShMrt(`gsShAtlasBackup${r}`,!1,e,t)));for(let i=0;i<this._shMrts.length;i++)this._renderShCopyPass(this._backupShMrts[i],this._shMrts[i].textures[0],this._mrt.textures[0],0,e,e,0,-s)}this._rotMrt&&this._rotCopyMaterial&&(this._backupRotMrt||(this._backupRotMrt=this._createRotMrt("gsRotAtlasBackup",!1,e,t)),this._renderRotCopyPass(this._backupRotMrt,this._rotMrt.textures,this._mrt.textures[0],0,e,e,0,-s)),this._quad.material=this._material}restoreRegion(){if(this._disposed||this._ownsMrt||!this._backupMrt||!this._copyMaterial)return;const e=this._textureSize,t=Math.max(1,Math.floor(this._capacity/e)),s=Math.floor(this._baseOffset/e),i=this._scene.getEngine();i.enableScissor(0,s,e,t);try{if(this._renderRelayoutPass(this._mrt,this._backupMrt.textures,this._backupMrt.textures[0],0,e,e,0,s),this._backupShMrts&&this._shMrts.length&&this._shCopyMaterial)for(let r=0;r<this._shMrts.length&&r<this._backupShMrts.length;r++)this._renderShCopyPass(this._shMrts[r],this._backupShMrts[r].textures[0],this._mrt.textures[0],0,e,e,0,s);this._backupRotMrt&&this._rotMrt&&this._rotCopyMaterial&&this._renderRotCopyPass(this._rotMrt,this._backupRotMrt.textures,this._mrt.textures[0],0,e,e,0,s)}finally{i.disableScissor(),this._quad.material=this._material}if(this._backupMrt.dispose(),this._backupMrt=null,this._backupShMrts){for(const r of this._backupShMrts)r.dispose();this._backupShMrts=null}this._backupRotMrt?.dispose(),this._backupRotMrt=null}_createMrt(e,t,s=this._textureSize,i=this._textureSize){const r=this._scene.getEngine()._caps.textureHalfFloatRender?T.TEXTURETYPE_HALF_FLOAT:T.TEXTURETYPE_FLOAT,a=new ue(e,{width:s,height:i},4,this._scene,{types:[T.TEXTURETYPE_FLOAT,r,r,T.TEXTURETYPE_UNSIGNED_BYTE],samplingModes:[T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURE_NEAREST_SAMPLINGMODE],formats:[T.TEXTUREFORMAT_RGBA,T.TEXTUREFORMAT_RGBA,T.TEXTUREFORMAT_RGBA,T.TEXTUREFORMAT_RGBA],generateDepthBuffer:!1,generateDepthTexture:!1,generateMipMaps:!1},[`${e}Centers`,`${e}CovA`,`${e}CovB`,`${e}Colors`]);return a.clearColor=new U(0,0,0,0),a.renderList=[],t&&a.onClearObservable.add(()=>{}),a}_createShMrt(e,t,s=this._textureSize,i=this._textureSize){const r=new ue(e,{width:s,height:i},1,this._scene,{types:[T.TEXTURETYPE_UNSIGNED_INTEGER],formats:[T.TEXTUREFORMAT_RGBA_INTEGER],samplingModes:[T.TEXTURE_NEAREST_SAMPLINGMODE],generateDepthBuffer:!1,generateDepthTexture:!1,generateMipMaps:!1},[e]);return r.clearColor=new U(0,0,0,0),r.renderList=[],t&&r.onClearObservable.add(()=>{}),r}_createRotMrt(e,t,s=this._textureSize,i=this._textureSize){const r=this._scene.getEngine()._caps.textureHalfFloatRender?T.TEXTURETYPE_HALF_FLOAT:T.TEXTURETYPE_FLOAT,a=new ue(e,{width:s,height:i},3,this._scene,{types:[r,r,r],formats:[T.TEXTUREFORMAT_RGBA,T.TEXTUREFORMAT_RGBA,T.TEXTUREFORMAT_RGBA],samplingModes:[T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURE_NEAREST_SAMPLINGMODE],generateDepthBuffer:!1,generateDepthTexture:!1,generateMipMaps:!1},[`${e}A`,`${e}B`,`${e}Scale`]);return a.clearColor=new U(0,0,0,0),a.renderList=[],t&&a.onClearObservable.add(()=>{}),a}async decodeAsync(e,t,s,i){if(this._disposed)return;const r=s??0,a=i??e.splatCount-r;if(s!==void 0||i!==void 0){if(!Number.isSafeInteger(e.splatCount)||e.splatCount<0||!Number.isSafeInteger(r)||r<0||!Number.isSafeInteger(a)||a<0||r+a>e.splatCount||!Number.isSafeInteger(t)||t<0||t+a>this._capacity)throw new RangeError("GaussianSplattingWorkBuffer: invalid source or destination decode range.");if(a===0)return}this._applyPack(e,r,a);const n=this._shMaterial!==null&&this._shMrts.length>0;n&&this._applyShPack(e,r,a);const o=this._rotMaterial!==null&&this._rotMrt!==null;o&&this._applyRotPack(e,r,a),await new Promise(l=>{const u=()=>{if(this._disposed){l();return}if(!this._material.isReady(this._quad)||n&&!this._shMaterial.isReady(this._quad)||o&&!this._rotMaterial.isReady(this._quad)){this._scene.onBeforeRenderObservable.addOnce(u);return}const d=this._textureSize,h=this._baseOffset+t;this._material.setInt("uOffset",h),n&&this._shMaterial.setInt("uOffset",h),o&&this._rotMaterial.setInt("uOffset",h);const c=Math.floor(h/d),m=Math.max(1,Math.ceil((h+a)/d)-c),S=this._scene.getEngine();S.enableScissor(0,c,d,m);try{if(this._quad.material=this._material,this._mrt.renderList=[this._quad],this._mrt.render(),n){for(let C=0;C<this._shMrts.length;C++)this._shMaterial.setInt("uShTextureIndex",C),this._quad.material=this._shMaterial,this._shMrts[C].renderList=[this._quad],this._shMrts[C].render();this._quad.material=this._material}o&&(this._quad.material=this._rotMaterial,this._rotMrt.renderList=[this._quad],this._rotMrt.render(),this._quad.material=this._material)}finally{S.disableScissor()}l()};this._scene.onBeforeRenderObservable.addOnce(u)})}isRelayoutReady(){if(this._disposed)return!1;this._copyMaterial||(this._copyMaterial=this._createCopyMaterial()),this._shMrts.length&&!this._shCopyMaterial&&(this._shCopyMaterial=this._createShCopyMaterial()),this._rotMrt&&!this._rotCopyMaterial&&(this._rotCopyMaterial=this._createRotCopyMaterial()),this._bindCopyMaterialsToAtlas();const e=this._shMrts.length===0||this._shCopyMaterial!==null&&this._shCopyMaterial.isReady(this._quad),t=!this._rotMrt||this._rotCopyMaterial!==null&&this._rotCopyMaterial.isReady(this._quad);return this._copyMaterial.isReady(this._quad)&&e&&t}_bindCopyMaterialsToAtlas(){const e=this._mrt.textures;if(this._copyMaterial&&(this._copyMaterial.setTexture("uMapTex",e[0]),this._copyMaterial.setTexture("uSrc0",e[0]),this._copyMaterial.setTexture("uSrc1",e[1]),this._copyMaterial.setTexture("uSrc2",e[2]),this._copyMaterial.setTexture("uSrc3",e[3])),this._shCopyMaterial&&this._shMrts.length&&(this._shCopyMaterial.setTexture("uMapTex",e[0]),this._shCopyMaterial.setTexture("uSrcSh",this._shMrts[0].textures[0])),this._rotCopyMaterial&&this._rotMrt){const t=this._rotMrt.textures;this._rotCopyMaterial.setTexture("uMapTex",e[0]),this._rotCopyMaterial.setTexture("uSrc0",t[0]),this._rotCopyMaterial.setTexture("uSrc1",t[1]),this._rotCopyMaterial.setTexture("uSrc2",t[2])}}relayoutSync(e){if(this._disposed||!this._copyMaterial)return;const t=this._textureSize,s=t,i=this._ownsMrt?t:Math.max(1,Math.floor(this._capacity/t));this._relayoutMapData||(this._relayoutMapData=new Float32Array(s*i));const r=this._relayoutMapData;r.fill(-1),r.set(e.subarray(0,Math.min(e.length,r.length))),this._relayoutMapTexture?this._relayoutMapTexture.update(r):this._relayoutMapTexture=new oe(r,s,i,T.TEXTUREFORMAT_R,this._scene,!1,!1,T.TEXTURE_NEAREST_SAMPLINGMODE,T.TEXTURETYPE_FLOAT,T.TEXTURE_CREATIONFLAG_SAMPLED_DATA_ONLY);const a=this._relayoutMapTexture;if(this._ownsMrt){const c=this._createMrt("gsRelayoutTemp",!1);try{this._renderRelayoutPass(c,this._mrt.textures,a,1),this._renderRelayoutPass(this._mrt,c.textures,a,0)}finally{c.dispose()}if(this._shMrts.length&&this._shCopyMaterial)for(let m=0;m<this._shMrts.length;m++){const S=this._createShMrt("gsShRelayoutTemp",!1);try{this._renderShCopyPass(S,this._shMrts[m].textures[0],a,1),this._renderShCopyPass(this._shMrts[m],S.textures[0],a,0)}finally{S.dispose()}}if(this._rotMrt&&this._rotCopyMaterial){const m=this._createRotMrt("gsRotRelayoutTemp",!1);try{this._renderRotCopyPass(m,this._rotMrt.textures,a,1),this._renderRotCopyPass(this._rotMrt,m.textures,a,0)}finally{m.dispose()}}this._quad.material=this._material;return}const n=Math.floor(this._baseOffset/t),o=i,l=this._scene.getEngine(),u=this._createMrt("gsRelayoutTemp",!1,t,o),d=this._shMrts.length&&this._shCopyMaterial?this._shMrts.map((c,m)=>this._createShMrt(`gsShRelayoutTemp${m}`,!1,t,o)):[],h=this._rotMrt&&this._rotCopyMaterial?this._createRotMrt("gsRotRelayoutTemp",!1,t,o):null;try{this._renderRelayoutPass(u,this._mrt.textures,a,1,t,t,this._baseOffset,0);for(let c=0;c<d.length;c++)this._renderShCopyPass(d[c],this._shMrts[c].textures[0],a,1,t,t,this._baseOffset,0);h&&this._renderRotCopyPass(h,this._rotMrt.textures,a,1,t,t,this._baseOffset,0),l.enableScissor(0,n,t,o);try{this._renderRelayoutPass(this._mrt,u.textures,a,0,t,t,0,n);for(let c=0;c<d.length;c++)this._renderShCopyPass(this._shMrts[c],d[c].textures[0],a,0,t,t,0,n);h&&this._renderRotCopyPass(this._rotMrt,h.textures,a,0,t,t,0,n)}finally{l.disableScissor()}}finally{u.dispose();for(const c of d)c.dispose();h?.dispose(),this._quad.material=this._material}}_renderRelayoutPass(e,t,s,i,r=this._textureSize,a=this._textureSize,n=0,o=0){const l=this._copyMaterial;l.setTexture("uMapTex",s),l.setTexture("uSrc0",t[0]),l.setTexture("uSrc1",t[1]),l.setTexture("uSrc2",t[2]),l.setTexture("uSrc3",t[3]),l.setInt("uDstWidth",r),l.setInt("uSrcWidth",a),l.setInt("uUseMap",i),l.setInt("uSrcBaseOffset",n),l.setInt("uDstBaseRow",o),this._quad.material=l,e.renderList=[this._quad],e.render()}_createCopyMaterial(){const e=this._shaderLanguage===1,t=new $(Je,this._scene,{vertexSource:e?Y:Q,fragmentSource:e?at:Ze},{attributes:["position"],uniforms:["uDstWidth","uSrcWidth","uUseMap","uSrcBaseOffset","uDstBaseRow"],samplers:["uMapTex","uSrc0","uSrc1","uSrc2","uSrc3"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}_renderShCopyPass(e,t,s,i,r=this._textureSize,a=this._textureSize,n=0,o=0){const l=this._shCopyMaterial;l.setTexture("uMapTex",s),l.setTexture("uSrcSh",t),l.setInt("uDstWidth",r),l.setInt("uSrcWidth",a),l.setInt("uUseMap",i),l.setInt("uSrcBaseOffset",n),l.setInt("uDstBaseRow",o),this._quad.material=l,e.renderList=[this._quad],e.render()}_createShCopyMaterial(){const e=this._shaderLanguage===1,t=new $(Ke,this._scene,{vertexSource:e?Y:Q,fragmentSource:e?tt:et},{attributes:["position"],uniforms:["uDstWidth","uSrcWidth","uUseMap","uSrcBaseOffset","uDstBaseRow"],samplers:["uMapTex","uSrcSh"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}_renderRotCopyPass(e,t,s,i,r=this._textureSize,a=this._textureSize,n=0,o=0){const l=this._rotCopyMaterial;l.setTexture("uMapTex",s),l.setTexture("uSrc0",t[0]),l.setTexture("uSrc1",t[1]),l.setTexture("uSrc2",t[2]),l.setInt("uDstWidth",r),l.setInt("uSrcWidth",a),l.setInt("uUseMap",i),l.setInt("uSrcBaseOffset",n),l.setInt("uDstBaseRow",o),this._quad.material=l,e.renderList=[this._quad],e.render()}_createRotCopyMaterial(){const e=this._shaderLanguage===1,t=new $(st,this._scene,{vertexSource:e?Y:Q,fragmentSource:e?rt:it},{attributes:["position"],uniforms:["uDstWidth","uSrcWidth","uUseMap","uSrcBaseOffset","uDstBaseRow"],samplers:["uMapTex","uSrc0","uSrc1","uSrc2"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}async readCentersRangeAsync(e,t){if(this._disposed||t<=0||!this.supportsAsyncCentersReadback)return null;const s=this._textureSize,i=this._baseOffset+e,r=Math.floor(i/s),n=Math.ceil((i+t)/s)-r,o=(i-r*s)*4,l=o+t*4,u=this._mrt.textures[0],d=this._scene.getEngine();if(d.isWebGPU){const x=await u.readPixels(0,0,null,!0,!0,0,r,s,n);if(this._disposed||!x)return null;const p=x instanceof Float32Array?x:new Float32Array(x.buffer,x.byteOffset,x.byteLength/4);return p.length>=l?p.subarray(o,l):null}const h=d,c=h._gl,m=u.getInternalTexture()?._hardwareTexture?.underlyingResource;if(!m)return null;const S=new Float32Array(s*n*4);this._readFbo||(this._readFbo=c.createFramebuffer());const C=h._currentFramebuffer;c.bindFramebuffer(c.FRAMEBUFFER,this._readFbo),c.framebufferTexture2D(c.FRAMEBUFFER,c.COLOR_ATTACHMENT0,c.TEXTURE_2D,m,0),c.readBuffer(c.COLOR_ATTACHMENT0);const f=h._readPixelsAsync(0,r,s,n,c.RGBA,c.FLOAT,S);return c.bindFramebuffer(c.FRAMEBUFFER,C),C||c.readBuffer(c.BACK),!f||(await f,this._disposed||S.length<l)?null:S.subarray(o,l)}dispose(){if(this._disposed=!0,this._readFbo&&(this._scene.getEngine()._gl?.deleteFramebuffer(this._readFbo),this._readFbo=null),this._quad.dispose(),this._material.dispose(!0,!1),this._shMaterial?.dispose(!0,!1),this._rotMaterial?.dispose(!0,!1),this._copyMaterial?.dispose(!0,!1),this._shCopyMaterial?.dispose(!0,!1),this._rotCopyMaterial?.dispose(!0,!1),this._relayoutMapTexture?.dispose(),this._backupMrt?.dispose(),this._backupMrt=null,this._backupShMrts){for(const e of this._backupShMrts)e.dispose();this._backupShMrts=null}if(this._backupRotMrt?.dispose(),this._backupRotMrt=null,this._ownsMrt&&this._mrt.dispose(),this._ownsShMrts)for(const e of this._shMrts)e.dispose();this._shMrts=[],this._ownsRotMrt&&this._rotMrt?.dispose(),this._rotMrt=null}_createQuad(){const e=new _e("gsWorkBufferQuad",this._scene),t=new pe;return t.positions=[-1,-1,0,3,-1,0,-1,3,0],t.indices=[0,1,2],t.applyToMesh(e),this._scene.removeMesh(e),e}_createMaterial(){const e=this._shaderLanguage===1,t=new $("gsSogDecode",this._scene,{vertexSource:e?Y:Q,fragmentSource:e?Ve:Ge},{attributes:["position"],uniforms:["sogMeansMin","sogMeansMax","sogScalesMin","sogScalesMax","sogSh0Min","sogSh0Max","uVersion","uOffset","uSourceOffset","uCount","uDestWidth","uSrcWidth"],samplers:["sogMeansLTex","sogMeansUTex","sogScalesTex","sogQuatsTex","sogSh0Tex","sogCodebookTex"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}_applyPack(e,t,s){const i=this._material,r=e.meansTextureL.getSize().width;i.setTexture("sogMeansLTex",e.meansTextureL),i.setTexture("sogMeansUTex",e.meansTextureU),i.setTexture("sogScalesTex",e.scalesTexture),i.setTexture("sogQuatsTex",e.quatsTexture),i.setTexture("sogSh0Tex",e.sh0Texture),i.setTexture("sogCodebookTex",e.codebookTexture??e.sh0Texture),i.setVector3("sogMeansMin",new F(e.meansMin[0],e.meansMin[1],e.meansMin[2])),i.setVector3("sogMeansMax",new F(e.meansMax[0],e.meansMax[1],e.meansMax[2]));const a=e.scalesMin??[0,0,0],n=e.scalesMax??[0,0,0];i.setVector3("sogScalesMin",new F(a[0],a[1],a[2])),i.setVector3("sogScalesMax",new F(n[0],n[1],n[2]));const o=e.sh0Min??[0,0,0,0],l=e.sh0Max??[0,0,0,0];i.setVector4("sogSh0Min",new xe(o[0],o[1],o[2],o[3])),i.setVector4("sogSh0Max",new xe(l[0],l[1],l[2],l[3])),i.setInt("uVersion",e.version),i.setInt("uSourceOffset",t),i.setInt("uCount",s),i.setInt("uDestWidth",this._textureSize),i.setInt("uSrcWidth",r)}_createShMaterial(){const e=this._shaderLanguage===1,t=new $(Xe,this._scene,{vertexSource:e?Y:Q,fragmentSource:e?Ye:Qe},{attributes:["position"],uniforms:["sogShnMin","sogShnMax","uVersion","uOffset","uSourceOffset","uCount","uDestWidth","uSrcWidth","uCoeffs","uShTextureIndex"],samplers:["sogShLabelsTex","sogShCentroidsTex","sogCodebookTex"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}_applyShPack(e,t,s){const i=this._shMaterial,r=!!e.shLabelsTexture&&!!e.shCentroidsTexture,a=e.shLabelsTexture??e.sh0Texture,n=e.shCentroidsTexture??e.sh0Texture;i.setTexture("sogShLabelsTex",a),i.setTexture("sogShCentroidsTex",n),i.setTexture("sogCodebookTex",e.codebookTexture??a),i.setFloat("sogShnMin",e.shnMin??0),i.setFloat("sogShnMax",e.shnMax??0),i.setInt("uVersion",e.version),i.setInt("uSourceOffset",t),i.setInt("uCount",s),i.setInt("uDestWidth",this._textureSize),i.setInt("uSrcWidth",a.getSize().width),i.setInt("uCoeffs",r?e.shCoeffCount:0)}_createRotMaterial(){const e=this._shaderLanguage===1,t=new $(je,this._scene,{vertexSource:e?Y:Q,fragmentSource:e?$e:He},{attributes:["position"],uniforms:["sogScalesMin","sogScalesMax","uVersion","uOffset","uSourceOffset","uCount","uDestWidth","uSrcWidth"],samplers:["sogScalesTex","sogQuatsTex","sogCodebookTex"],shaderLanguage:this._shaderLanguage});return t.backFaceCulling=!1,t.disableDepthWrite=!0,t}_applyRotPack(e,t,s){const i=this._rotMaterial,r=e.scalesTexture.getSize().width;i.setTexture("sogScalesTex",e.scalesTexture),i.setTexture("sogQuatsTex",e.quatsTexture),i.setTexture("sogCodebookTex",e.codebookTexture??e.scalesTexture);const a=e.scalesMin??[0,0,0],n=e.scalesMax??[0,0,0];i.setVector3("sogScalesMin",new F(a[0],a[1],a[2])),i.setVector3("sogScalesMax",new F(n[0],n[1],n[2])),i.setInt("uVersion",e.version),i.setInt("uSourceOffset",t),i.setInt("uCount",s),i.setInt("uDestWidth",this._textureSize),i.setInt("uSrcWidth",r)}}class nt{constructor(e){this._activeCount=0,this._queue=[],this._pending=new Map,this._groups=new Map,this._disposed=!1,this.maxConcurrent=Math.max(1,e?.maxConcurrent??2),this.maxRetries=Math.max(0,e?.maxRetries??2)}get isIdle(){return this._pending.size===0}async loadFileAsync(e,t){if(this._disposed)throw new Error("GaussianSplattingDownloadManager has been disposed.");let s=this._pending.get(e);const i=!s;s||(s={url:e,consumers:new Set,settled:!1,cancelled:!1,started:!1,slotReleased:!1},this._pending.set(e,s),this._queue.push(s));const r={task:s,groupId:t};if(r.promise=new Promise((a,n)=>{r.resolve=a,r.reject=n}),s.consumers.add(r),t!==void 0){let a=this._groups.get(t);a||(a=new Set,this._groups.set(t,a)),a.add(r)}return i&&this._pump(),await r.promise}cancel(e){const t=this._pending.get(e);t&&this._abort(t,new Error(`GaussianSplattingDownloadManager: download cancelled (${e}).`))}cancelGroup(e){const t=this._groups.get(e);if(t)for(const s of Array.from(t))this._cancelConsumer(s,new Error(`GaussianSplattingDownloadManager: download cancelled (${s.task.url}).`))}dispose(){if(!this._disposed){this._disposed=!0,this._queue.length=0;for(const e of Array.from(this._pending.values()))this._abort(e,new Error("GaussianSplattingDownloadManager has been disposed."))}}_abort(e,t){if(e.settled)return;e.cancelled=!0;const s=this._queue.indexOf(e);s!==-1&&this._queue.splice(s,1),e.request?.abort(),e.cancelAttempt?.(t),this._settle(e,i=>i.reject(t)),e.started&&this._releaseSlot(e)}_cancelConsumer(e,t){const s=e.task;s.consumers.has(e)&&(this._removeConsumer(e),e.reject(t),s.consumers.size===0&&this._abort(s,t))}_removeConsumer(e){if(e.task.consumers.delete(e),e.groupId!==void 0){const t=this._groups.get(e.groupId);t?.delete(e),t?.size===0&&this._groups.delete(e.groupId)}}_settle(e,t){if(!e.settled){e.settled=!0,this._pending.get(e.url)===e&&this._pending.delete(e.url);for(const s of e.consumers)this._removeConsumer(s),t(s)}}_releaseSlot(e){e.slotReleased||(e.slotReleased=!0,this._activeCount--,this._pump())}_pump(){for(;!this._disposed&&this._activeCount<this.maxConcurrent&&this._queue.length>0;){const e=this._queue.shift();e.settled||(e.started=!0,this._activeCount++,this._runTaskAsync(e).finally(()=>{this._releaseSlot(e)}))}}async _runTaskAsync(e){let t;for(let s=0;s<=this.maxRetries;s++){if(this._disposed||e.cancelled)return;try{const i=await this._downloadAttemptAsync(e);this._settle(e,r=>r.resolve(i));return}catch(i){if(e.cancelAttempt=void 0,this._disposed||e.cancelled)return;t=i}}this._settle(e,s=>s.reject(t))}async _downloadAttemptAsync(e){return await new Promise((t,s)=>{e.cancelAttempt=s,e.request=le.LoadFile(e.url,i=>t(i),void 0,void 0,!0,(i,r)=>s(r instanceof Error?r:new Error(`GaussianSplattingDownloadManager: failed to load ${e.url}.`)))})}}class ot{constructor(){this._offset=0,this._size=0,this._free=!0,this._prev=null,this._next=null,this._prevFree=null,this._nextFree=null,this._bucket=-1}get offset(){return this._offset}get size(){return this._size}}class lt{constructor(e=0,t=1.1){if(this._headAll=null,this._tailAll=null,this._freeBucketHeads=[],this._pool=[],this._capacity=0,this._usedSize=0,this._freeSize=0,this._freeRegionCount=0,this._growMultiplier=t,e>0){this._capacity=e,this._freeSize=e;const s=this._obtain(0,e,!0);this._headAll=s,this._tailAll=s,this._addToBucket(s)}}get capacity(){return this._capacity}get usedSize(){return this._usedSize}get freeSize(){return this._freeSize}get fragmentation(){return this._freeSize>0?1-1/this._freeRegionCount:0}allocate(e){if(e<=0)return null;const t=this._findFreeBlock(e);if(!t)return null;if(this._usedSize+=e,this._freeSize-=e,t._size===e)return t._free=!1,this._removeFromBucket(t),t;const s=this._obtain(t._offset,e,!1);return t._offset+=e,t._size-=e,this._rebucket(t),this._insertAfterInMainList(s,t._prev),s}free(e){if(!e||e._free)return;e._free=!0,this._usedSize-=e._size,this._freeSize+=e._size;const t=e._prev,s=e._next,i=t&&t._free,r=s&&s._free;i&&r?(t._size+=e._size+s._size,this._removeFromMainList(e),this._removeFromMainList(s),this._removeFromBucket(s),this._release(e),this._release(s),this._rebucket(t)):i?(t._size+=e._size,this._removeFromMainList(e),this._release(e),this._rebucket(t)):r?(e._size+=s._size,this._removeFromMainList(s),this._removeFromBucket(s),this._release(s),this._addToBucket(e)):this._addToBucket(e)}grow(e){if(e<=this._capacity)return;const t=e-this._capacity;if(this._capacity=e,this._freeSize+=t,this._tailAll&&this._tailAll._free)this._tailAll._size+=t,this._rebucket(this._tailAll);else{const s=this._obtain(this._capacity-t,t,!0);this._insertAfterInMainList(s,this._tailAll),this._addToBucket(s)}}defrag(e=0,t=new Set){return t.clear(),this._freeRegionCount===0||(e===0?this._defragFull(t):this._defragIncremental(e,t)),t}updateAllocation(e,t){for(let s=0;s<e.length;s++)this.free(e[s]);for(let s=0;s<t.length;s++){const i=t[s],r=this.allocate(i);if(r)t[s]=r;else{let a=i;for(let l=s+1;l<t.length;l++)a+=t[l];const n=this._usedSize+a,o=Math.ceil(n*this._growMultiplier);o>this._capacity&&this.grow(o),this.defrag(0);for(let l=s;l<t.length;l++)t[l]=this.allocate(t[l]);return!0}}return!1}_bucketFor(e){return 31-Math.clz32(e)}_addToBucket(e){const t=this._bucketFor(e._size);for(e._bucket=t;t>=this._freeBucketHeads.length;)this._freeBucketHeads.push(null);e._prevFree=null,e._nextFree=this._freeBucketHeads[t],this._freeBucketHeads[t]&&(this._freeBucketHeads[t]._prevFree=e),this._freeBucketHeads[t]=e,this._freeRegionCount++}_removeFromBucket(e){const t=e._bucket;e._prevFree?e._prevFree._nextFree=e._nextFree:this._freeBucketHeads[t]=e._nextFree,e._nextFree&&(e._nextFree._prevFree=e._prevFree),e._prevFree=null,e._nextFree=null,e._bucket=-1,this._freeRegionCount--}_rebucket(e){this._bucketFor(e._size)!==e._bucket&&(this._removeFromBucket(e),this._addToBucket(e))}_obtain(e,t,s){const i=this._pool.length>0?this._pool.pop():new ot;return i._offset=e,i._size=t,i._free=s,i._prev=null,i._next=null,i._prevFree=null,i._nextFree=null,i._bucket=-1,i}_release(e){e._prev=null,e._next=null,e._prevFree=null,e._nextFree=null,e._bucket=-1,this._pool.push(e)}_insertAfterInMainList(e,t){t===null?(e._prev=null,e._next=this._headAll,this._headAll&&(this._headAll._prev=e),this._headAll=e,this._tailAll||(this._tailAll=e)):(e._prev=t,e._next=t._next,t._next&&(t._next._prev=e),t._next=e,this._tailAll===t&&(this._tailAll=e))}_removeFromMainList(e){e._prev?e._prev._next=e._next:this._headAll=e._next,e._next?e._next._prev=e._prev:this._tailAll=e._prev,e._prev=null,e._next=null}_findFreeBlock(e){const t=this._bucketFor(e),s=this._freeBucketHeads.length;if(t<s){let i=null,r=this._freeBucketHeads[t];for(;r&&!(r._size>=e&&(!i||r._size<i._size)&&(i=r,r._size===e));)r=r._nextFree;if(i)return i}for(let i=t+1;i<s;i++)if(this._freeBucketHeads[i])return this._freeBucketHeads[i];return null}_defragFull(e){for(let r=0;r<this._freeBucketHeads.length;r++){let a=this._freeBucketHeads[r];for(;a;){const n=a._nextFree;this._removeFromMainList(a),a._prevFree=null,a._nextFree=null,a._bucket=-1,this._pool.push(a),a=n}this._freeBucketHeads[r]=null}this._freeRegionCount=0;let t=0,s=this._headAll;for(;s;)s._offset!==t&&(s._offset=t,e.add(s)),t+=s._size,s=s._next;const i=this._capacity-t;if(i>0){const r=this._obtain(t,i,!0);this._insertAfterInMainList(r,this._tailAll),this._addToBucket(r)}}_defragIncremental(e,t){const s=Math.ceil(e/2),i=e-s;for(let a=0;a<s;a++){let n=this._tailAll;for(;n&&n._free;)n=n._prev;if(!n)break;const o=this._findFreeBlock(n._size);if(!o||o._offset>=n._offset)break;this._moveBlock(n,o),t.add(n)}let r=this._headAll;for(let a=0;a<i&&r;){const n=r._next;if(r._free&&n&&!n._free){const o=n,l=r;o._offset=l._offset,l._offset=o._offset+o._size;const u=l._prev,d=o._next;if(o._prev=u,o._next=l,l._prev=o,l._next=d,u?u._next=o:this._headAll=o,d?d._prev=l:this._tailAll=l,l._next&&l._next._free){const h=l._next;l._size+=h._size,this._removeFromMainList(h),this._removeFromBucket(h),this._release(h),this._rebucket(l)}t.add(o),a++,r=l._next}else r=n}}_moveBlock(e,t){const s=e._size,i=t._offset,r=e._prev;this._removeFromMainList(e);const a=this._obtain(e._offset,s,!0);if(this._insertAfterInMainList(a,r),this._addToBucket(a),a._next&&a._next._free){const n=a._next;a._size+=n._size,this._removeFromMainList(n),this._removeFromBucket(n),this._release(n),this._rebucket(a)}if(a._prev&&a._prev._free){const n=a._prev;n._size+=a._size,this._removeFromMainList(a),this._removeFromBucket(a),this._release(a),this._rebucket(n)}if(e._offset=i,t._size===s){const n=t._prev;this._removeFromMainList(t),this._removeFromBucket(t),this._release(t),this._insertAfterInMainList(e,n)}else t._offset+=s,t._size-=s,this._rebucket(t),this._insertAfterInMainList(e,t._prev)}}class ut{constructor(e,t,s){this._blocks=new Map,this._cooldown=new Map,this._pinned=new Set,this._allocator=new lt(e),this._cooldownFrames=Math.max(0,t),this._onEvict=s}get capacity(){return this._allocator.capacity}get residentCount(){return this._blocks.size}get freeSize(){return this._allocator.freeSize}has(e){return this._blocks.has(e)}offset(e){return this._blocks.get(e)?.offset}allocate(e,t){const s=this._blocks.get(e);if(s)return s.offset;let i=this._allocator.allocate(t);return!i&&(this._evictAllCooled(),i=this._allocator.allocate(t),!i)?null:(this._blocks.set(e,i),i.offset)}pin(e,t){const s=this.allocate(e,t);return s!==null&&this._pinned.add(e),s}free(e){if(this._pinned.has(e))return;const t=this._blocks.get(e);t&&(this._allocator.free(t),this._blocks.delete(e),this._cooldown.delete(e))}compact(){const e=new Map;for(const[s,i]of Array.from(this._blocks))e.set(s,i.offset);this._allocator.defrag(0);const t=[];for(const[s,i]of Array.from(this._blocks)){const r=e.get(s);r!==i.offset&&t.push({file:s,oldOffset:r,newOffset:i.offset,count:i.size})}return t}getResidentBlocks(){const e=[];for(const[t,s]of Array.from(this._blocks))e.push({file:t,offset:s.offset,count:s.size});return e}scheduleEviction(e){this._pinned.has(e)||!this._blocks.has(e)||this._cooldown.set(e,this._cooldownFrames)}cancelEviction(e){this._cooldown.delete(e)}tick(){if(this._cooldown.size===0)return[];const e=[];for(const[t,s]of Array.from(this._cooldown))s<=1?e.push(t):this._cooldown.set(t,s-1);for(const t of e)this._evict(t);return e}dispose(){this._blocks.clear(),this._cooldown.clear(),this._pinned.clear()}_evictAllCooled(){const e=Array.from(this._cooldown.keys());for(const t of e)this._evict(t)}_evict(e){const t=this._blocks.get(e);t&&(this._allocator.free(t),this._blocks.delete(e)),this._cooldown.delete(e),this._onEvict(e)}}function ct(g,e,t,s,i){if(!Number.isSafeInteger(s)||s<0||!Number.isSafeInteger(i)||i<s)throw new RangeError("Invalid residency page ID range.");const r=new Map,a=new Set,n=[],o=new Set;for(const u of g){if(o.has(u))continue;o.add(u);const d=u.file;if(!Number.isSafeInteger(d)||d<0||d>=s){a.has(d)||(a.add(d),n.push(d));continue}if(t.has(d))continue;const h=e.get(d);if(h===void 0)continue;if(!Number.isSafeInteger(h)||h<0||!Number.isSafeInteger(u.offset)||u.offset<0||!Number.isSafeInteger(u.count)||u.count<0||u.offset+u.count>h){a.has(d)||(a.add(d),n.push(d));continue}if(u.count===0)continue;let c=r.get(d);c||(c=[],r.set(d,c)),c.push(u)}const l=[];for(const[u,d]of r){if(a.has(u))continue;d.sort((c,m)=>c.offset-m.offset||c.count-m.count);let h;for(const c of d)if(h&&c.offset<h.source.offset+h.source.count)h.source={file:u,offset:h.source.offset,count:Math.max(h.source.offset+h.source.count,c.offset+c.count)-h.source.offset},h.entries.push(c);else{const m=i+l.length;if(!Number.isSafeInteger(m))throw new RangeError("Residency page ID overflow.");h={id:m,source:{file:u,offset:c.offset,count:c.count},entries:[c]},l.push(h)}}return{pages:l,invalidFiles:n}}const ht=Math.tan(22.5*Math.PI/180),ft=-2,te=-1,dt=84,se=4,_t=5,pt=32,mt=512,gt=256,fe=new re,xt=new F,St=new F,Me=new F,bt=new F(0,0,1),Ce=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],ve=Ce.length*2,ie=[new U(1,.2,.2,1),new U(1,.6,.1,1),new U(1,1,.2,1),new U(.3,1,.3,1),new U(.2,1,1,1),new U(.4,.5,1,1),new U(.9,.4,1,1),new U(1,1,1,1)];class O extends ee{static IsLODMetadata(e){if(typeof e!="object"||e===null)return!1;const t=e;return typeof t.lodLevels=="number"&&Array.isArray(t.filenames)&&typeof t.tree=="object"&&t.tree!==null}constructor(e,t,s,i,r={}){const a=O._NormalizeResidentLimit(r.maxResidentSplats??0,"maxResidentSplats",!0),n=O._NormalizeResidentLimit(r.memoryBudgetMb??0,"memoryBudgetMb",!1);if(r.rangePack&&!r.rangeResidency)throw new Error("GaussianSplattingStream: rangePack requires rangeResidency.");super(e,null,i,!1),this._leafNodes=[],this._lod0SplatCount=Object.freeze({status:"pending"}),this._lodBaseDistance=5,this._lodMultiplier=3,this._lodBehindPenalty=1,this._lodRangeMin=0,this._maxDecodesPerFrame=1,this._lodCooldownFrames=10,this._lodUpdateInterval=4,this._lodUpdateDistance=.5,this._maxDetailLod=0,this._lodPixelThreshold=1,this._hostBudgetAllocation=null,this._frustumCulling=!0,this._frustumPlanes=[new X(0,0,0,0),new X(0,0,0,0),new X(0,0,0,0),new X(0,0,0,0),new X(0,0,0,0),new X(0,0,0,0)],this._cullCameraViewProj=new re,this._cullViewProj=new re,this._frustumScratch=[],this._workBuffer=null,this._streamShDegree=0,this._shTextureCount=0,this._needsRotationScale=!1,this._useGpuPositionReadback=!1,this._readbackCandidate=!1,this._readbackProbed=!1,this._residency=null,this._fileCounts=new Map,this._fileMeta=new Map,this._residencyPages=new Map,this._splitPacks=new Map,this._nextPageId=0,this._rangeSourcePack=null,this._activeRangeSource=null,this._rangeSourcePackLoads=0,this._rangeSourcePackReuses=0,this._rangeSplitPackLoads=0,this._baseFileIds=new Set,this._decodedFiles=new Set,this._loadingFiles=new Set,this._decodeQueue=[],this._fileRefs=new Map,this._cancelledDecodes=new Set,this._evictionEnabled=!1,this._residentBudget=0,this._minimumResidentSplats=0,this._maxResidentSplats=0,this._memoryBudgetMb=0,this._evictionCooldownFrames=100,this._decodeGate=Promise.resolve(),this._relayoutOldOffsets=new Map,this._relayoutSrcIndex=null,this._environmentRange=null,this._environmentFiles=null,this._lodObserver=null,this._baseLayerReady=!1,this._metadataReady=!1,this._framesSinceLodUpdate=0,this._lastLodCamPositions=[],this._lastLodSignature="",this._forceLodUpdate=!1,this._boundsMin=new F(Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE),this._boundsMax=new F(-Number.MAX_VALUE,-Number.MAX_VALUE,-Number.MAX_VALUE),this._debugDisplay=!1,this._debugLodSource="optimal",this._debugMesh=null,this._debugObserver=null,this._debugColorData=null,this._debugSignature=0,this._disposed=!1,this._hostCompound=null,this._host=null,this._positionBase=0,this._unsubBeforeRebuild=null,this._unsubAfterRebuild=null,this._hostUnsubRemove=null,this._hostUnsubDispose=null,this._partReleasedByHost=!1,this._positionSnapshot=null,this._partReadyPromise=null,this._partReadyResolve=null,this._partReadyReject=null,this._partReadySettled=!1,this._metadata=r.rangeResidency?O._CloneLodMetadata(t):t,this._nextPageId=t.filenames.length,this._rootUrl=s,this._streamOptions=r,this._hostCompound=r.hostCompound??null,this._decodeSh=r.decodeSh??!0,this._needsRotationScale=r.needsRotationScale??!1;const o=Math.max(0,t.lodLevels-1);if(this._lodRangeMax=o,r.lodBaseDistance!==void 0&&(this._lodBaseDistance=Math.max(.1,r.lodBaseDistance)),r.lodMultiplier!==void 0&&(this._lodMultiplier=Math.max(1.2,r.lodMultiplier)),r.lodBehindPenalty!==void 0&&(this._lodBehindPenalty=Math.max(1,r.lodBehindPenalty)),r.lodRangeMin!==void 0&&(this._lodRangeMin=Math.max(0,Math.min(r.lodRangeMin,o))),r.lodRangeMax!==void 0&&(this._lodRangeMax=Math.max(this._lodRangeMin,Math.min(r.lodRangeMax,o))),r.maxDecodesPerFrame!==void 0&&(this._maxDecodesPerFrame=Math.max(1,r.maxDecodesPerFrame)),r.lodCooldownFrames!==void 0&&(this._lodCooldownFrames=Math.max(0,r.lodCooldownFrames)),r.lodUpdateInterval!==void 0&&(this._lodUpdateInterval=Math.max(1,r.lodUpdateInterval)),r.lodUpdateDistance!==void 0&&(this._lodUpdateDistance=Math.max(0,r.lodUpdateDistance)),r.maxDetailLod!==void 0&&(this._maxDetailLod=Math.max(0,Math.floor(r.maxDetailLod))),this._splatBudget=this._resolveSplatBudget(r.splatBudget),r.frustumCulling!==void 0&&(this._frustumCulling=r.frustumCulling),r.debugLodSource&&(this._debugLodSource=r.debugLodSource),r.evictionCooldownFrames!==void 0&&(this._evictionCooldownFrames=Math.max(0,Math.floor(r.evictionCooldownFrames))),this._maxResidentSplats=a,this._memoryBudgetMb=n,this._downloadManager=new nt({maxConcurrent:r.maxConcurrentDownloads,maxRetries:r.maxDownloadRetries}),!this._hostCompound)this.scaling.y*=-1,this.rotation.x=-Math.PI/2;else{this.setEnabled(!1),this.isPickable=!1,this.doNotSerialize=!0,this._partReadyPromise=new Promise((u,d)=>{this._partReadyResolve=u,this._partReadyReject=d}),this._partReadyPromise.catch(()=>{});const l=this._hostCompound.onDisposeObservable.add(()=>{this._disposed||(this._partReleasedByHost=!0,this.dispose())});this._hostUnsubDispose=()=>this._hostCompound.onDisposeObservable.remove(l)}this._collectLodEntries(this._metadata.tree),r.debugDisplay&&(this.debugDisplay=!0),this._streamAllAsync().then(()=>{const l=this._partReadySettled;this._rejectPartReady("GaussianSplattingStream: stream produced no splats."),!l&&this._hostCompound&&!this._disposed&&this._disposeAndReclaim()},l=>{this._lod0SplatCount=Object.freeze({status:"unavailable"}),E.Error("GaussianSplattingStream: streaming failed: "+(l?.message??l)),this._rejectPartReady("GaussianSplattingStream: streaming failed: "+(l?.message??l)),this._disposed||this._disposeAndReclaim()})}getClassName(){return"GaussianSplattingStream"}isReady(e=!1){return this._hostCompound?!0:super.isReady(e)}get streamingPartProxy(){return this._host?.proxy??null}async whenPartReadyAsync(){await(this._partReadyPromise??Promise.resolve())}_resolvePartReady(){this._partReadySettled||(this._partReadySettled=!0,this._partReadyResolve?.())}_rejectPartReady(e){this._partReadySettled||(this._partReadySettled=!0,this._partReadyReject?.(new Error(e)))}async whenSettledAsync(e=3){if(this._disposed)return;this._forceLodUpdate=!0;const t=Math.max(1,e),s=this._scene;let i=0;const r=()=>this._isLoadingIdle()&&this._sinkIsDepthSortSettled?++i>=t:(i=0,!1);if(s.getEngine().activeRenderLoops.length>0){await new Promise(o=>{let l=null;l=s.onAfterRenderObservable.add(()=>{(this._disposed||r())&&(l&&(s.onAfterRenderObservable.remove(l),l=null),o())})});return}const a=s.getEngine(),n=globalThis.requestAnimationFrame;for(;!this._disposed;){if(a.beginFrame(),s.render(),a.endFrame(),r())return;await new Promise(o=>{typeof n=="function"?n(()=>o()):setTimeout(o,16)})}}_isLoadingIdle(){return this._baseLayerReady&&this._metadataReady&&this._decodeQueue.length===0&&this._loadingFiles.size===0&&this._downloadManager.isIdle}get maxDetailLod(){return this._maxDetailLod}set maxDetailLod(e){const t=Math.max(0,Math.floor(e));this._maxDetailLod!==t&&(this._maxDetailLod=t,this._forceLodUpdate=!0)}get splatBudget(){return this._splatBudget}set splatBudget(e){const t=e>0?Math.floor(e):0;t!==this._splatBudget&&(this._splatBudget=t,this._forceLodUpdate=!0)}get effectiveSplatBudget(){return this._effectiveSplatBudget()}get residentSplatBudget(){return this._residentBudget}get minimumResidentSplats(){return this._minimumResidentSplats}get lod0SplatCount(){return this._lod0SplatCount}getSourceRange(e){return this._residencyPages.get(e)??null}isSplitPage(e){return this._splitPacks.has(e)}cancelRangeLoads(e,t=[]){const s=new Set;for(const i of e){const r=this._residencyPages.get(i);!r||!this._loadingFiles.has(i)||(this._cancelledDecodes.add(i),this._splitPacks.has(i)?this._downloadManager.cancelGroup(i):s.add(r.file))}if(s.size!==0){for(const i of t)s.delete(i);for(const i of this._loadingFiles){if(this._cancelledDecodes.has(i)||this._splitPacks.has(i))continue;const r=this._residencyPages.get(i);r&&s.delete(r.file)}for(const i of s)this._downloadManager.cancelGroup(i)}}get rangeResidencyStats(){return{enabled:this._streamOptions.rangeResidency===!0,pages:this._residencyPages.size,sourcePackLoads:this._rangeSourcePackLoads,sourcePackReuses:this._rangeSourcePackReuses,splitPackLoads:this._rangeSplitPackLoads,cachedSourceSplats:this._rangeSourcePack?.pack.splatCount??0}}_resolveSplatBudget(e){return e===void 0?0:e==="auto"?this._computeDefaultSplatBudget():e>0?Math.floor(e):0}_computeDefaultSplatBudget(){return!this._scene.getEngine().hostInformation?.isMobile?25e5:typeof navigator<"u"&&navigator.userAgent&&/iPad|iPhone|iPod/.test(navigator.userAgent)?15e5:1e6}_effectiveSplatBudget(){if(this._hostBudgetAllocation!==null){const e=Math.max(1,this._hostBudgetAllocation);return this._residentBudget>0?Math.min(e,this._residentBudget):e}return this._splatBudget<=0?0:this._residentBudget>0?Math.min(this._splatBudget,this._residentBudget):this._splatBudget}_splatBudgetEnabled(){return this._effectiveSplatBudget()>0}getBudgetDemand(){if(!this._baseLayerReady)return 0;let e=this._environmentSplatCount();for(const t of this._leafNodes){const s=t.optimalLod??t.baseLod;e+=this._countAtLevel(t,this._cappedLevelForNode(t,s))}return e}setBudgetAllocation(e){if(e===null){this._hostBudgetAllocation!==null&&(this._hostBudgetAllocation=null,this._forceLodUpdate=!0);return}const t=this._hostBudgetAllocation;this._hostBudgetAllocation=e,(t===null||e!==t)&&(this._forceLodUpdate=!0)}get maxLodLevel(){return Math.max(0,this._metadata.lodLevels-1)}get frustumCulling(){return this._frustumCulling}set frustumCulling(e){this._frustumCulling!==e&&(this._frustumCulling=e,this._forceLodUpdate=!0)}get debugDisplay(){return this._debugDisplay}set debugDisplay(e){this._debugDisplay!==e&&(this._debugDisplay=e,e?this._refreshDebugDisplay():this._clearDebugDisplay())}get debugLodSource(){return this._debugLodSource}set debugLodSource(e){this._debugLodSource!==e&&(this._debugLodSource=e,this._debugDisplay&&this._refreshDebugDisplay())}dispose(e){this._disposed||(this._disposed=!0,this._rejectPartReady("GaussianSplattingStream: disposed before the part was ready."),this._unsubBeforeRebuild?.(),this._unsubAfterRebuild?.(),this._unsubBeforeRebuild=null,this._unsubAfterRebuild=null,this._hostUnsubRemove?.(),this._hostUnsubDispose?.(),this._hostUnsubRemove=null,this._hostUnsubDispose=null,this._hostCompound&&!this._hostCompound.isDisposed()&&this._hostCompound.unregisterLodBudgetParticipant(this),this._host&&this._hostCompound&&!this._partReleasedByHost&&!this._hostCompound.isDisposed()&&this._hostCompound.removePart(this._host.partIndex),this._host=null,this._lodObserver&&(this._scene.onBeforeRenderObservable.remove(this._lodObserver),this._lodObserver=null),this._clearDebugDisplay(),this._downloadManager.dispose(),this._disposeRangeSourcePack(),this._splitPacks.clear(),this._residencyPages.clear(),this._residency?.dispose(),this._residency=null,this._workBuffer?.dispose(),this._workBuffer=null,super.dispose(e))}_disposeAndReclaim(){const e=this._hostCompound,t=!!this._host&&!this._partReleasedByHost;this.dispose(),t&&e&&!e.isDisposed()&&e.compactAtlas()}_getEffectiveWorldMatrix(e){return this._host?this._host.proxy.computeWorldMatrix(e):this.computeWorldMatrix(e)}_getActiveLodCameras(){return(this._scene.activeCameras?.length?this._scene.activeCameras:this._scene.activeCamera?[this._scene.activeCamera]:[]).filter(t=>!!t)}evaluateOptimalLods(e=null){const t=e?[e]:this._getActiveLodCameras();if(t.length===0||this._leafNodes.length===0)return;const s=Math.max(0,this._metadata.lodLevels-1),i=this._lodBaseDistance,r=this._lodMultiplier,a=this._lodBehindPenalty,n=this._lodRangeMin,o=this._lodRangeMax,l=this._splatBudgetEnabled(),u=this._scene.getEngine().getRenderHeight()||1,d=this._scene.getEngine();this._getEffectiveWorldMatrix(!1).invertToRef(fe);const h=t.map(c=>{const m=d.getAspectRatio(c)||1;let S=Math.tan(c.fov*.5);c.fovMode===Te.FOVMODE_HORIZONTAL_FIXED&&(S/=m);const C=S*m,f=Math.min(S,C)/ht,x=u*(c.viewport?c.viewport.height:1),p=F.TransformCoordinatesToRef(c.globalPosition,fe,xt),y={px:p.x,py:p.y,pz:p.z,fwx:0,fwy:0,fwz:0,fovScale:f,tanHalfV:S,pixelHeight:x};if(a>1){c.getDirectionToRef(bt,Me);const M=F.TransformNormalToRef(Me,fe,St);M.normalize(),y.fwx=M.x,y.fwy=M.y,y.fwz=M.z}return y});for(const c of this._leafNodes){const m=c.bound.min,S=c.bound.max,C=(m[0]+S[0])*.5,f=(m[1]+S[1])*.5,x=(m[2]+S[2])*.5,p=S[0]-m[0],y=S[1]-m[1],M=S[2]-m[2],_=.5*Math.sqrt(p*p+y*y+M*M);let b=Number.POSITIVE_INFINITY,w=0;for(const v of h){const D=v.px<m[0]?m[0]:v.px>S[0]?S[0]:v.px,L=v.py<m[1]?m[1]:v.py>S[1]?S[1]:v.py,q=v.pz<m[2]?m[2]:v.pz>S[2]?S[2]:v.pz,P=D-v.px,R=L-v.py,A=q-v.pz,B=Math.sqrt(P*P+R*R+A*A);let k=B;if(a>1&&B>.01){const W=(v.fwx*P+v.fwy*R+v.fwz*A)/B;W<0&&(k=B*(1+-W*(a-1)))}const I=k*v.fovScale;let z;if(s===0||I<i)z=0;else for(z=s;z>1&&I<i*Math.pow(r,z-1);)z--;if(z<b&&(b=z),l){const W=C-v.px,j=f-v.py,G=x-v.pz,H=Math.sqrt(W*W+j*j+G*G),V=_*v.pixelHeight/(Math.max(H,1e-4)*v.tanHalfV);V>w&&(w=V)}}b<n?b=n:b>o&&(b=o),this._frustumCulling&&c.inFrustum===!1&&(b=o),c.optimalLod=b,l&&(c.pixelSize=w)}}_displayedLodLevel(e){return this._debugLodSource==="optimal"?e.optimalLod??e.activeLod??0:e.activeLod??0}_refreshDebugDisplay(){this._debugLodSource==="optimal"&&this.evaluateOptimalLods(),this._buildDebugMesh();const e=this._debugDisplay;e&&!this._debugObserver?this._debugObserver=this._scene.onBeforeRenderObservable.add(()=>this._onDebugFrame()):!e&&this._debugObserver&&(this._scene.onBeforeRenderObservable.remove(this._debugObserver),this._debugObserver=null)}_onDebugFrame(){this._debugLodSource==="optimal"&&this.evaluateOptimalLods(),this._computeDebugSignature()!==this._debugSignature&&this._updateDebugColors()}_buildDebugMesh(){this._debugMesh&&(this._debugMesh.dispose(),this._debugMesh=null),this._debugColorData=null;const e=[],t=[];for(const i of this._leafNodes){const r=ie[this._displayedLodLevel(i)%ie.length],a=i.bound.min,n=i.bound.max,o=[new F(a[0],a[1],a[2]),new F(n[0],a[1],a[2]),new F(n[0],n[1],a[2]),new F(a[0],n[1],a[2]),new F(a[0],a[1],n[2]),new F(n[0],a[1],n[2]),new F(n[0],n[1],n[2]),new F(a[0],n[1],n[2])];for(const l of Ce)e.push([o[l[0]],o[l[1]]]),t.push([r,r])}if(this._debugSignature=this._computeDebugSignature(),e.length===0)return;const s=Le(this.name+"_lodDebug",{lines:e,colors:t,updatable:!0,useVertexAlpha:!1},this._scene);s.parent=this,s.isPickable=!1,s.doNotSerialize=!0,s.reservedDataStore={hidden:!0},this._debugMesh=s,this._debugColorData=new Float32Array(this._leafNodes.length*ve*4)}_updateDebugColors(){if(!this._debugMesh||!this._debugColorData)return;const e=this._debugColorData;let t=0;for(const s of this._leafNodes){const i=ie[this._displayedLodLevel(s)%ie.length];for(let r=0;r<ve;r++)e[t++]=i.r,e[t++]=i.g,e[t++]=i.b,e[t++]=i.a}this._debugMesh.updateVerticesData(qe.ColorKind,e),this._debugSignature=this._computeDebugSignature()}_computeDebugSignature(){let e=0;for(const t of this._leafNodes)e=e*31+this._displayedLodLevel(t)|0;return e}_clearDebugDisplay(){this._debugObserver&&(this._scene.onBeforeRenderObservable.remove(this._debugObserver),this._debugObserver=null),this._debugMesh&&(this._debugMesh.dispose(),this._debugMesh=null),this._debugColorData=null,this._debugSignature=0}_collectLodEntries(e){if(e.children){for(const c of e.children)this._collectLodEntries(c);return}if(!e.lods)return;const t=e.bound?.min,s=e.bound?.max;if(!t||!s||t.length<3||s.length<3||!t.every(c=>Number.isFinite(c))||!s.every(c=>Number.isFinite(c)))return;const i=s[0]-t[0],r=s[1]-t[1],a=s[2]-t[2],n=Math.sqrt(i*i+r*r+a*a);if(!Number.isFinite(n)||n<=0)return;const o=Math.floor(Number(this._metadata.lodLevels)),l=Number.isFinite(o)&&o>0?o-1:0,u=[];for(const c of Object.keys(e.lods)){const m=Number(c),S=e.lods[c],C=S?Math.floor(Number(S.count)):NaN;if(Number.isInteger(m)&&String(m)===c&&m>=0&&m<=l&&S&&Number.isFinite(C)&&C>0){if(this._streamOptions.rangeResidency&&(!Number.isSafeInteger(S.file)||S.file<0||S.file>=this._metadata.filenames.length)){E.Warn(`GaussianSplattingStream: invalid LOD file index ${S.file}; skipping level ${m}.`);continue}S.count=C,u.push(m)}}if(u.length===0)return;u.sort((c,m)=>c-m);const d=[];let h=1/0;for(const c of u){const m=e.lods[String(c)].count;m<=h&&(d.push(c),h=m)}e.availableLevels=d,e.baseLod=d[d.length-1],e.activeLod=void 0,e.lodCooldown=0,e.inFrustum=!0,e.cullBounds=new Se(F.FromArray(t),F.FromArray(s)),this._leafNodes.push(e)}async _streamAllAsync(){const e=this._collectAllFileIds(),t=this._collectBaseFileIds();this._baseFileIds.clear();for(const l of t)this._baseFileIds.add(l);if(this._leafNodes.length>0&&t.length===0)throw new Error("GaussianSplattingStream: no valid coarse source files were referenced.");const s=e.length>pt&&t.length<e.length;s&&this._decodeSh&&(this._streamShDegree=se,this._shTextureCount=_t);const i=s?t:e,r=await this._gatherCountsAsync(i);if(this._disposed)return;for(const l of t){const u=this._fileCounts.get(l);if(!this._fileMeta.has(l)||u===void 0||u<=0)throw new Error(`GaussianSplattingStream: required coarse metadata for file ${l} is unavailable or invalid.`)}this._resolveMinimumResidentSplats(t,r),s||(this._resolveLod0SplatCount(),this._metadataReady=!0);let a=null;if(!s){a=1+r;for(const l of e){const u=this._fileCounts.get(l);u!==void 0&&u>0&&(a=O._SafeAddCounts(a,u,"stream capacity"))}}if(this._minimumResidentSplats<=1)throw new Error("GaussianSplattingStream: stream produced no splats.");let n=0;for(const l of t)n=Math.max(n,this._fileCounts.get(l));const o=this._resolveResidentBudget(a,n);if(this._evictionEnabled=s||a!==null&&o<a,this._residency=new ut(o,this._evictionCooldownFrames,l=>this._onFileEvicted(l)),this._residency.pin(ft,1),r>0){const l=this._residency.allocate(te,r);l!==null?this._environmentRange={offset:l,count:r}:(E.Warn("GaussianSplattingStream: environment does not fit the memory budget; skipping it."),this._environmentFiles=null)}if(this._hostCompound){const l=re.Compose(new F(1,-1,1),Ae.RotationYawPitchRoll(0,-Math.PI/2,0),F.ZeroReadOnly),u=this._hostCompound.reserveStreamingPart(o,l,this.name+"_part",this._shTextureCount,this._streamShDegree,this._needsRotationScale);this._host=u,this._positionBase=u.base,this._hostCompound.registerLodBudgetParticipant(this);const d=this._hostCompound,h=d.onPartRemovedObservable.add(C=>{!this._disposed&&this._host&&C===this._host.partIndex&&(this._partReleasedByHost=!0,this.dispose())});this._hostUnsubRemove=()=>d.onPartRemovedObservable.remove(h);const c=this._shTextureCount>0&&u.shMrtAtlas?{textureCount:this._shTextureCount,externalMrts:u.shMrtAtlas}:void 0,m=this._needsRotationScale&&u.rotMrtAtlas?{externalMrt:u.rotMrtAtlas}:void 0;this._workBuffer=new ye(this._scene,u.capacity,{mrt:u.mrtAtlas,width:u.atlasWidth,baseOffset:u.base},c,m),this._readbackCandidate=this._workBuffer.supportsAsyncCentersReadback,this._splatPositions=u.splatPositions,this._vertexCount=o;const S=this._workBuffer;this._unsubBeforeRebuild=u.onBeforeAtlasRebuild(()=>{S.backupRegion(),this._positionSnapshot=this._splatPositions?this._splatPositions.slice(this._positionBase*4,(this._positionBase+this._vertexCount)*4):null}),this._unsubAfterRebuild=u.onAfterAtlasRebuild(()=>{u.mrtAtlas&&S.rebindAtlas(u.mrtAtlas),S.rebindShAtlas(u.shMrtAtlas),S.rebindRotAtlas(u.rotMrtAtlas),this._positionBase=u.base,S.setBaseOffset(u.base),S.restoreRegion(),this._splatPositions=u.splatPositions,this._positionSnapshot&&this._splatPositions&&(this._splatPositions.set(this._positionSnapshot,this._positionBase*4),this._positionSnapshot=null)}),u.setActiveRanges([])}else{const l=this._shTextureCount>0?{textureCount:this._shTextureCount}:void 0,u=this._needsRotationScale?{}:void 0;this._workBuffer=new ye(this._scene,o,void 0,l,u),this._readbackCandidate=this._workBuffer.supportsAsyncCentersReadback;const d=new Float32Array(o*4),h=this._workBuffer.textures,c=l?this._workBuffer.shTextures:void 0,m=u?this._workBuffer.rotationTextures:void 0;this._setExternalWorkBuffer(h[0],h[1],h[2],h[3],d,o,c,this._streamShDegree,m),this.setSplatIndexRanges([]),this.setEnabled(!0)}if(!(this._host&&this._workBuffer&&(await this._waitForCanBackupAsync(this._workBuffer),this._disposed))){this._environmentRange&&this._environmentFiles&&await this._decodeEnvironmentAsync(),this._environmentFiles=null;for(const l of t){if(this._disposed)return;if(!await this._decodeFileAsync(l))throw new Error(`GaussianSplattingStream: required coarse file ${l} failed to decode.`)}if(!this._disposed){for(const l of this._leafNodes)if(l.activeLod!==l.baseLod||l.activeFile===void 0)throw new Error("GaussianSplattingStream: the complete coarse layer could not be activated.");if(this._baseLayerReady=!0,this._resolvePartReady(),s){const l=e.filter(u=>!this._baseFileIds.has(u));if(await this._gatherCountsAsync(l,!1),this._resolveLod0SplatCount(),this._metadataReady=!0,this._disposed)return}this._lodObserver||(this._lodObserver=this._scene.onBeforeRenderObservable.add(()=>this._onLodFrame()))}}}async _waitForCanBackupAsync(e){for(let t=0;t<600&&!this._disposed;t++){if(e.canBackup)return;await new Promise(s=>this._scene.onBeforeRenderObservable.addOnce(()=>s()))}!this._disposed&&!e.canBackup&&E.Warn("GaussianSplattingStream: backup/restore copy shaders did not compile in time; a grow/compaction before they are ready may drop streamed data.")}_resolveResidentBudget(e=null,t=0){const s=this._maxResidentSplats>0||this._memoryBudgetMb>0;let i=this._maxResidentSplats>0?this._maxResidentSplats:Number.POSITIVE_INFINITY;const r=this._bytesPerResidentSplat();if(this._memoryBudgetMb>0){const a=Math.floor(this._memoryBudgetMb*1024*1024/r);i=Math.min(i,a)}if(!s&&e!==null)i=e;else if(s)i<this._minimumResidentSplats&&E.Warn(`GaussianSplattingStream: the requested initial residency (${i} splats) is below the complete coarse minimum (${this._minimumResidentSplats}); using the minimum.`);else{const a=this._scene.getEngine().hostInformation?.isMobile?gt:mt,n=Math.floor(a*1024*1024/r),o=Math.max(0,Math.floor(t)),l=O._SafeAddCounts(this._minimumResidentSplats,o,"automatic resident capacity");i=Math.max(n,l)}if(i=Math.max(this._minimumResidentSplats,Math.floor(i)),e!==null&&(i=Math.min(i,e)),e!==null||this._minimumResidentSplats>0){const a=Math.floor(this._scene.getEngine().getCaps().maxTextureSize),n=a*a;if(!Number.isSafeInteger(n)||this._minimumResidentSplats>n)throw new Error(`GaussianSplattingStream: minimum resident splat count ${this._minimumResidentSplats} exceeds the device texture capacity ${n}.`);if(i>n&&(i=n),i<this._minimumResidentSplats)throw new Error(`GaussianSplattingStream: minimum resident splat count ${this._minimumResidentSplats} exceeds the device texture capacity ${n}.`)}if(!Number.isSafeInteger(i)||i<this._minimumResidentSplats||i<1)throw new Error("GaussianSplattingStream: resolved resident capacity is invalid.");return this._residentBudget=i,i}_bytesPerResidentSplat(){const e=this._scene.getEngine().getCaps().textureHalfFloatRender?24:48;return dt+this._shTextureCount*16+(this._needsRotationScale?e:0)}_collectAllFileIds(){const e=new Set;for(const t of this._leafNodes)for(const s of t.availableLevels){const i=t.lods[String(s)];i&&e.add(i.file)}return Array.from(e).sort((t,s)=>t-s)}_collectBaseFileIds(){const e=new Set;for(const t of this._leafNodes){const s=t.lods?.[String(t.baseLod)];s&&e.add(s.file)}return Array.from(e).sort((t,s)=>t-s)}_resolveMinimumResidentSplats(e,t){let s=O._SafeAddCounts(1,Math.max(0,Math.floor(t)),"minimum resident splats");for(const i of e){const r=this._fileCounts.get(i);if(r===void 0||!Number.isSafeInteger(r)||r<=0)throw new Error(`GaussianSplattingStream: required coarse metadata for file ${i} is unavailable or invalid.`);s=O._SafeAddCounts(s,r,"minimum resident splats")}this._minimumResidentSplats=s}_resolveLod0SplatCount(){let e=0,t=!1;for(const s of this._leafNodes){if(s.availableLevels?.[0]!==0)continue;const i=s.lods?.["0"];if(!i){this._lod0SplatCount=Object.freeze({status:"unavailable"});return}if(t=!0,!this._fileCounts.has(i.file)||!this._fileMeta.has(i.file)){this._lod0SplatCount=Object.freeze({status:"unavailable"});return}if(e+=i.count,!Number.isSafeInteger(e)){this._lod0SplatCount=Object.freeze({status:"unavailable"});return}}this._lod0SplatCount=Object.freeze(t?{status:"available",count:e}:{status:"unavailable"})}async _gatherCountsAsync(e,t=!0){let s=0,i=0,r=0;const a=n=>{const o=O._GetShInfo(n);o.degree>i&&(i=o.degree),o.coeffs>r&&(r=o.coeffs)};if(t&&this._metadata.environment)try{const n=this._rootUrl+this._metadata.environment,o=await this._downloadManager.loadFileAsync(n),l=await this._unzipAsync(new Uint8Array(o)),u=l.get("meta.json");if(u){const d=JSON.parse(new TextDecoder().decode(u));s=O._GetSplatCount(d),a(d),this._environmentFiles=l}}catch(n){E.Warn("GaussianSplattingStream: failed to load environment: "+(n?.message??n))}await Promise.all(e.map(async n=>{const o=this._metadata.filenames[n];if(!o){E.Warn(`GaussianSplattingStream: missing filename for file index ${n}.`);return}try{const l=this._rootUrl+o,u=l.substring(0,l.lastIndexOf("/")+1),d=await this._downloadManager.loadFileAsync(l),h=JSON.parse(new TextDecoder().decode(new Uint8Array(d)));this._fileCounts.set(n,O._GetSplatCount(h)),this._fileMeta.set(n,{sogData:h,subRootUrl:u})}catch(l){E.Warn(`GaussianSplattingStream: failed to load metadata for ${o}: ${l?.message??l}`)}}));for(const{sogData:n}of this._fileMeta.values())a(n);return this._decodeSh&&i>0&&r>0&&(this._streamShDegree=Math.max(this._streamShDegree,i),this._shTextureCount=Math.max(this._shTextureCount,Math.ceil(r*3/16))),this._streamOptions.rangeResidency&&this._initializeResidencyPages(e),s}_initializeResidencyPages(e){const t=new Set(e),s=[];for(const a of this._leafNodes)for(const n of a.availableLevels){const o=a.lods[String(n)];t.has(o.file)&&s.push(o)}const{pages:i,invalidFiles:r}=ct(s,this._fileCounts,this._baseFileIds,this._metadata.filenames.length,this._nextPageId);for(const a of r)E.Warn(`GaussianSplattingStream: invalid LOD interval in file ${a}; keeping it as one resident file.`);for(const a of i){const n=this._fileMeta.get(a.source.file);this._fileMeta.set(a.id,n),this._fileCounts.set(a.id,a.source.count);const o=Object.freeze({...a.source});this._residencyPages.set(a.id,o);const l=this._resolveSplitPack(a.id,o,n.sogData);l&&this._splitPacks.set(a.id,l);for(const u of a.entries)u.file=a.id,u.offset-=a.source.offset}this._nextPageId+=i.length,i.length&&(this._forceLodUpdate=!0)}_resolveSplitPack(e,t,s){const i=this._streamOptions.rangePack;if(!i)return null;try{const r=i(t,s);return r?O._GetSplatCount(r.sogData)!==t.count?(E.Warn(`GaussianSplattingStream: split pack for page ${e} does not hold ${t.count} splats; using the source pack.`),null):r:null}catch(r){return E.Warn(`GaussianSplattingStream: rangePack failed for page ${e}: ${r?.message??r}; using the source pack.`),null}}async _loadPrefetchedPackAsync(e,t){const s=e.sogData,i=new Set([...s.means?.files??[],...s.scales?.files??[],...s.quats?.files??[],...s.sh0?.files??[],...s.shN?.files??[]]),r=new Map;if(await Promise.all(Array.from(i,async n=>{r.set(n,new Uint8Array(await this._downloadManager.loadFileAsync(e.subRootUrl+n,t)))})),this._disposed)return null;r.set("meta.json",new TextEncoder().encode(JSON.stringify(s)));const a=(await ae(r,"",this._scene,!this._useGpuPositionReadback)).sogTextures;return a?this._disposed?(O._DisposePack(a),null):a:null}async _getRangeSourcePackAsync(e,t){if(this._rangeSourcePack?.file===e)return this._rangeSourcePackReuses++,this._rangeSourcePack.pack;this._disposeRangeSourcePack();const s=await this._loadPrefetchedPackAsync(t,e);return s?this._disposed?(O._DisposePack(s),null):(this._rangeSourcePackLoads++,this._rangeSourcePack={file:e,pack:s},s):null}_disposeRangeSourcePack(){this._rangeSourcePack&&(O._DisposePack(this._rangeSourcePack.pack),this._rangeSourcePack=null)}static _CloneLodMetadata(e){return{...e,tree:O._CloneLodNode(e.tree)}}static _CloneLodNode(e){const t={};if(e.bound&&(t.bound={min:Array.isArray(e.bound.min)?e.bound.min.slice():e.bound.min,max:Array.isArray(e.bound.max)?e.bound.max.slice():e.bound.max}),Array.isArray(e.children)&&(t.children=e.children.map(s=>O._CloneLodNode(s))),e.lods){t.lods={};for(const s of Object.keys(e.lods)){const i=e.lods[s];t.lods[s]=i&&typeof i=="object"?{...i}:i}}return t}_enqueueDecode(e){this._decodedFiles.has(e)||this._loadingFiles.has(e)||!this._fileMeta.has(e)||this._decodeQueue.indexOf(e)===-1&&this._decodeQueue.push(e)}_pumpDecodeQueue(){let e=0;for(;this._decodeQueue.length>0&&e<this._maxDecodesPerFrame;){const t=this._decodeQueue.shift();this._decodedFiles.has(t)||this._loadingFiles.has(t)||(e++,this._decodeFileAsync(t).catch(s=>{E.Warn("GaussianSplattingStream: decode failed: "+(s?.message??s))}))}}_applyPositions(e,t,s){this._splatPositions.set(e,(this._positionBase+t)*4),this._updateBounds(e,s),this._sinkPostPositionsRange(t,s)}_sinkSetActiveRanges(e){this._host?this._host.setActiveRanges(e):this.setSplatIndexRanges(e)}_sinkPostPositionsRange(e,t){this._host?this._host.postPositionsRange(e,t):this._postWorkerPositionsRange(e,t)}_sinkNotifyDataChanged(){this._host?this._host.notifyDataChanged():this._notifyWorkerNewData()}get _sinkIsDepthSortSettled(){return this._host?this._host.isDepthSortSettled:this._isDepthSortSettled}async _probeReadbackAsync(e,t,s){if(this._readbackProbed=!0,!this._workBuffer)return;const i=Math.min(t,1024);let r=!1;try{const a=await this._workBuffer.readCentersRangeAsync(e,i);if(this._disposed)return;if(a&&a.length>=i*4){r=!0;for(let n=0;n<i&&r;n++)for(let o=0;o<3;o++){const l=a[n*4+o],u=s[n*4+o];if(Math.abs(l-u)>.01*(1+Math.abs(u))){r=!1;break}}}}catch{r=!1}this._useGpuPositionReadback=r,E.Log(r?"GaussianSplattingStream: GPU position readback validated; streamed LOD positions are read back from the GPU.":"GaussianSplattingStream: GPU position readback unavailable; decoding LOD positions on the CPU.")}async _applyDecodedPositionsAsync(e,t,s,i=0){if(this._useGpuPositionReadback&&this._workBuffer){const a=await this._workBuffer.readCentersRangeAsync(t,s);if(this._disposed)return!1;if(a&&this._splatPositions)return this._applyPositions(a,t,s),!0}const r=e.positions.length>=(i+s)*4?e.positions.subarray(i*4,(i+s)*4):null;return!r||!this._splatPositions?!1:(this._applyPositions(r,t,s),!this._readbackProbed&&this._readbackCandidate&&await this._probeReadbackAsync(t,s,r),!0)}async _decodeEnvironmentAsync(){if(!this._environmentRange||!this._environmentFiles||!this._workBuffer)return;const e=this._environmentRange;let t=!1;try{const i=(await ae(this._environmentFiles,"",this._scene,!this._useGpuPositionReadback,this._downloadManager)).sogTextures;if(!i){E.Warn("GaussianSplattingStream: environment decoding produced no texture data.");return}try{if(this._disposed||!this._workBuffer||(await this._workBuffer.decodeAsync(i,e.offset),this._disposed))return;const r=await this._applyDecodedPositionsAsync(i,e.offset,e.count);if(this._disposed)return;if(!r){E.Warn("GaussianSplattingStream: decoded positions could not be applied for the environment.");return}if(this._residency?.pin(te,e.count)!==e.offset)throw new Error("GaussianSplattingStream: decoded environment could not be pinned.");t=!0,this._refreshActiveRanges()}finally{O._DisposePack(i)}}catch(s){E.Warn("GaussianSplattingStream: failed to decode environment: "+(s?.message??s))}finally{t||(this._residency?.free(te),this._environmentRange=null)}}async _decodeFileAsync(e){if(this._decodedFiles.has(e))return!0;if(this._loadingFiles.has(e)||!this._residency)return!1;const t=this._fileMeta.get(e),s=this._fileCounts.get(e);if(!t||s===void 0)return!1;this._loadingFiles.add(e),this._cancelledDecodes.delete(e);let i=!1;const r=this._residencyPages.get(e),a=this._splitPacks.get(e);let n=null;try{let o,l=!0;if(a)o=await this._loadPrefetchedPackAsync(a,e);else if(r){if(n=await this._acquireDecodeGateAsync(),this._disposed||this._cancelledDecodes.has(e))return!1;o=await this._getRangeSourcePackAsync(r.file,t),l=!1,o&&(this._activeRangeSource=r.file)}else o=(await ae(t.sogData,t.subRootUrl,this._scene,!this._useGpuPositionReadback,this._downloadManager,e)).sogTextures??null;if(!o)return!1;a&&this._rangeSplitPackLoads++;const u=r&&!a?r.offset:0;n??(n=await this._acquireDecodeGateAsync());try{if(this._disposed||!this._workBuffer||this._cancelledDecodes.has(e))return!1;const d=this._residency;if(!d)return!1;let h=d.allocate(e,s);if(h===null&&(h=await this._relayoutAndAllocateAsync(e,s)),h===null)return this._cancelledDecodes.has(e)||E.Warn(`GaussianSplattingStream: resident memory budget full; skipping LOD file ${e}.`),!1;if(i=!0,this._disposed||!this._workBuffer||this._cancelledDecodes.has(e)||(r?await this._workBuffer.decodeAsync(o,h,u,s):await this._workBuffer.decodeAsync(o,h),this._disposed||this._cancelledDecodes.has(e)))return!1;const c=await this._applyDecodedPositionsAsync(o,h,s,u);if(this._disposed||this._cancelledDecodes.has(e))return!1;if(!c)return E.Warn(`GaussianSplattingStream: decoded positions could not be applied for LOD file ${e}.`),!1;if(this._baseFileIds.has(e)&&d.pin(e,s)!==h)throw new Error(`GaussianSplattingStream: required coarse file ${e} could not be pinned.`);return this._decodedFiles.add(e),this._applyDesiredLods()&&this._refreshActiveRanges(),!0}finally{l&&O._DisposePack(o)}}catch(o){if(!this._cancelledDecodes.has(e))throw o;return!1}finally{r&&!a&&n&&(this._activeRangeSource=null),n?.(),i&&!this._decodedFiles.has(e)&&this._residency?.free(e);const o=this._cancelledDecodes.has(e);this._loadingFiles.delete(e),this._cancelledDecodes.delete(e),o&&!this._disposed&&(this._fileRefs.get(e)??0)>0&&this._enqueueDecode(e)}}async _acquireDecodeGateAsync(){const e=this._decodeGate;let t;return this._decodeGate=new Promise(s=>{t=s}),await e,t}async _relayoutAndAllocateAsync(e,t){return!this._residency||!this._workBuffer||this._residency.freeSize<t?null:await new Promise(s=>{const i=()=>{if(this._disposed||!this._residency||!this._workBuffer||this._cancelledDecodes.has(e)){s(null);return}if(!this._workBuffer.isRelayoutReady()){this._scene.onBeforeRenderObservable.addOnce(i);return}this._performRelayout(),s(this._residency.allocate(e,t))};this._scene.onBeforeRenderObservable.addOnce(i)})}_performRelayout(){if(!this._residency||!this._workBuffer||!this._splatPositions)return;const e=this._relayoutOldOffsets;e.clear();for(const o of this._residency.getResidentBlocks())e.set(o.file,o.offset);if(this._residency.compact().length===0)return;const s=this._residency.capacity;(!this._relayoutSrcIndex||this._relayoutSrcIndex.length!==s)&&(this._relayoutSrcIndex=new Float32Array(s));const i=this._relayoutSrcIndex;i.fill(-1);const r=this._residency.getResidentBlocks();for(const o of r){const l=e.get(o.file);for(let u=0;u<o.count;u++)i[o.offset+u]=l+u}this._workBuffer.relayoutSync(i);const a=this._splatPositions,n=this._positionBase;r.sort((o,l)=>o.offset-l.offset);for(const o of r){const l=e.get(o.file);l!==o.offset&&a.copyWithin((n+o.offset)*4,(n+l)*4,(n+l+o.count)*4)}if(this._environmentRange){const o=this._residency.offset(te);o!==void 0&&(this._environmentRange.offset=o)}this._sinkNotifyDataChanged(),this._refreshActiveRanges()}_onFileEvicted(e){this._decodedFiles.delete(e)}_cappedLevelForNode(e,t){const s=e.availableLevels,i=this._maxDetailLod;let r=-1,a=Number.POSITIVE_INFINITY;for(const n of s){if(n<i)continue;const o=Math.abs(n-t);o<a&&(r=n,a=o)}return r<0?e.baseLod:r}_computeTargetLevels(){const e=this._effectiveSplatBudget();if(e<=0){for(const i of this._leafNodes){const r=i.optimalLod??i.baseLod;i.targetLevel=this._cappedLevelForNode(i,r)}return}const t=Math.max(0,e-this._environmentSplatCount());this._convergePixelThreshold(t);const s=this._lodPixelThreshold;for(const i of this._leafNodes)i.targetLevel=this._budgetedLevel(i,s)}_environmentSplatCount(){const e=this._environmentRange?Math.floor(Number(this._environmentRange.count)):0;return Number.isFinite(e)&&e>0?e:0}_budgetedLevel(e,t){const s=e.optimalLod??e.baseLod,i=e.pixelSize??0;let r=0;return i>0&&t>i&&(r=Math.max(0,Math.round(Math.log(t/i)/Math.log(this._lodMultiplier)))),this._cappedLevelForNode(e,s+r)}_countAtLevel(e,t){const s=e.lods[String(t)];return s?s.count:0}_totalSplatsAtThreshold(e){let t=0;for(const s of this._leafNodes)t+=this._countAtLevel(s,this._budgetedLevel(s,e));return t}_convergePixelThreshold(e){if(this._totalSplatsAtThreshold(1)<=e){this._lodPixelThreshold=1;return}let s=1;for(const o of this._leafNodes)o.pixelSize&&o.pixelSize>s&&(s=o.pixelSize);const i=Math.min(32,Math.max(1,this._metadata.lodLevels)),r=s*Math.pow(this._lodMultiplier,i+1);if(this._totalSplatsAtThreshold(r)>e){this._lodPixelThreshold=r;return}let a=1,n=r;for(let o=0;o<40&&n-a>.001*n;o++){const l=.5*(a+n);this._totalSplatsAtThreshold(l)<=e?n=l:a=l}this._lodPixelThreshold=n}_residentLevelAtLeast(e,t){for(const s of e.availableLevels)if(s>=t&&this._decodedFiles.has(e.lods[String(s)].file))return s;return null}_applyDesiredLods(){let e=!1;for(const t of this._leafNodes){const s=t.targetLevel??t.baseLod;if(this._splatBudgetEnabled()&&t.activeLod!==void 0&&t.activeLod<s){const r=this._residentLevelAtLeast(t,s);r!==null&&r!==t.activeLod&&(this._switchActiveFile(t,t.lods[String(r)].file),t.activeLod=r,t.lodCooldown=this._lodCooldownFrames,e=!0)}if(t.lodCooldown&&t.lodCooldown>0)continue;let i;if(s!==t.activeLod){const r=t.lods[String(s)];r&&(this._decodedFiles.has(r.file)?(this._switchActiveFile(t,r.file),t.activeLod=s,t.lodCooldown=this._lodCooldownFrames,e=!0):i=r.file)}t.pendingFile!==i&&(t.pendingFile!==void 0&&this._releaseFileRef(t.pendingFile),i!==void 0&&this._acquirePendingFile(i),t.pendingFile=i)}return e}_switchActiveFile(e,t){e.activeFile!==t&&(e.activeFile!==void 0&&this._releaseFileRef(e.activeFile),this._acquireFileRef(t),e.activeFile=t)}_acquireFileRef(e){const t=(this._fileRefs.get(e)??0)+1;this._fileRefs.set(e,t),t===1&&this._residency?.cancelEviction(e)}_acquirePendingFile(e){this._acquireFileRef(e),this._enqueueDecode(e)}_releaseFileRef(e){const t=(this._fileRefs.get(e)??0)-1;if(t>0){this._fileRefs.set(e,t);return}if(this._fileRefs.delete(e),this._decodedFiles.has(e)){this._evictionEnabled&&this._residency?.scheduleEviction(e);return}const s=this._decodeQueue.indexOf(e);if(s!==-1&&this._decodeQueue.splice(s,1),this._loadingFiles.has(e)){const i=this._residencyPages.get(e);if(i){let r=!1;for(const a of this._decodeQueue)if(!this._splitPacks.has(a)&&this._residencyPages.get(a)?.file===i.file){r=!0;break}this.cancelRangeLoads([e],r?[i.file]:[])}else this._cancelledDecodes.add(e),this._downloadManager.cancelGroup(e)}else if(s!==-1){const i=this._residencyPages.get(e);if(i&&!this._splitPacks.has(e)){let r=!1,a=!1;for(const n of this._loadingFiles)if(!(this._splitPacks.has(n)||this._residencyPages.get(n)?.file!==i.file))if(this._cancelledDecodes.has(n))a=!0;else{r=!0;break}if(a&&!r){for(const n of this._decodeQueue)if(!this._splitPacks.has(n)&&this._residencyPages.get(n)?.file===i.file){r=!0;break}r||this._downloadManager.cancelGroup(i.file)}}}}_onLodFrame(){if(this._disposed||!this._baseLayerReady)return;if(this._rangeSourcePack){const i=this._rangeSourcePack.file;let r=this._activeRangeSource===i;if(!r){for(const a of this._loadingFiles)if(!this._cancelledDecodes.has(a)&&!this._splitPacks.has(a)&&this._residencyPages.get(a)?.file===i){r=!0;break}}if(!r){for(const a of this._decodeQueue)if(!this._splitPacks.has(a)&&this._residencyPages.get(a)?.file===i){r=!0;break}}r||this._disposeRangeSourcePack()}let e=!1;for(const i of this._leafNodes)i.lodCooldown&&i.lodCooldown>0&&(i.lodCooldown--,i.lodCooldown===0&&i.targetLevel!==void 0&&i.targetLevel!==i.activeLod&&(e=!0));this._evictionEnabled&&this._residency?.tick(),this._pumpDecodeQueue();const t=this._updateNodeFrustum();let s=this._forceLodUpdate||t||e;if(!s&&++this._framesSinceLodUpdate>=this._lodUpdateInterval){const i=this._getActiveLodCameras(),r=this._lodUpdateDistance;if(i.length!==this._lastLodCamPositions.length||this._computeLodSignature(i)!==this._lastLodSignature)s=!0;else for(let a=0;a<i.length;a++)if(F.DistanceSquared(i[a].globalPosition,this._lastLodCamPositions[a])>=r*r){s=!0;break}}if(s){this._forceLodUpdate=!1,this._framesSinceLodUpdate=0;const i=this._getActiveLodCameras();this._lastLodCamPositions.length=0;for(const r of i)this._lastLodCamPositions.push(r.globalPosition.clone());this._lastLodSignature=this._computeLodSignature(i),this.evaluateOptimalLods(),this._computeTargetLevels(),this._applyDesiredLods()&&this._refreshActiveRanges()}}_computeLodSignature(e){const t=this._scene.getEngine();let s=`${t.getRenderWidth()}x${t.getRenderHeight()}#${this._getEffectiveWorldMatrix(!1).updateFlag}`;for(const i of e){const r=i.viewport;s+=`|${i.uniqueId}:${i.fov}:${i.fovMode}:${r.x},${r.y},${r.width},${r.height}`}return s}_updateNodeFrustum(){const e=this._getActiveLodCameras();let t=!1;if(!this._frustumCulling||e.length===0){for(const a of this._leafNodes)a.inFrustum===!1&&(a.inFrustum=!0,t=!0);return t}const s=this._leafNodes,i=this._frustumScratch,r=this._getEffectiveWorldMatrix(!1);for(let a=0;a<s.length;a++)i[a]=!1;for(const a of e){a.getViewMatrix().multiplyToRef(a.getProjectionMatrix(),this._cullCameraViewProj),r.multiplyToRef(this._cullCameraViewProj,this._cullViewProj),ke.GetPlanesToRef(this._cullViewProj,this._frustumPlanes);let n=!0;for(const o of this._frustumPlanes)if(!Number.isFinite(o.normal.x)||!Number.isFinite(o.normal.y)||!Number.isFinite(o.normal.z)||!Number.isFinite(o.d)||o.normal.lengthSquared()===0){n=!1;break}if(!n){for(let o=0;o<s.length;o++)i[o]=!0;continue}for(let o=0;o<s.length;o++)!i[o]&&s[o].cullBounds.isInFrustum(this._frustumPlanes)&&(i[o]=!0)}for(let a=0;a<s.length;a++)i[a]!==s[a].inFrustum&&(s[a].inFrustum=i[a],t=!0);return t}static _NormalizeResidentLimit(e,t,s){if(!Number.isFinite(e))throw new RangeError(`GaussianSplattingStream: ${t} must be finite.`);if(e<=0)return 0;const i=s?Math.max(1,Math.floor(e)):e;if(i>Number.MAX_SAFE_INTEGER)throw new RangeError(`GaussianSplattingStream: ${t} is outside the supported range.`);return i}static _SafeAddCounts(e,t,s){const i=e+t;if(!Number.isSafeInteger(e)||e<0||!Number.isSafeInteger(t)||t<0||!Number.isSafeInteger(i))throw new Error(`GaussianSplattingStream: ${s} exceeds the supported integer range.`);return i}static _GetSplatCount(e){const t=e.count??(Array.isArray(e.means.shape)?e.means.shape[0]:0),s=Math.floor(Number(t));return Number.isFinite(s)&&s>0?s:0}static _GetShInfo(e){if(!e.shN)return{degree:0,coeffs:0};let t=0;const s=e.shN.bands;if(typeof s=="number"&&Number.isFinite(s)&&s>0)t=Math.floor(s);else if(Array.isArray(e.shN.shape)&&Number.isFinite(e.shN.shape[1])&&e.shN.shape[1]>0){const i=Math.floor(e.shN.shape[1]/3);t=i>0?Math.round(Math.sqrt(i+1)-1):0}return t>0?(t>se&&(E.Warn(`GaussianSplattingStream: SH degree ${t} exceeds the maximum supported (${se}); clamping.`),t=se),{degree:t,coeffs:(t+1)**2-1}):{degree:0,coeffs:0}}static _DisposePack(e){e.meansTextureL.dispose(),e.meansTextureU.dispose(),e.scalesTexture.dispose(),e.quatsTexture.dispose(),e.sh0Texture.dispose(),e.shCentroidsTexture?.dispose(),e.shLabelsTexture?.dispose(),e.codebookTexture?.dispose()}_updateBounds(e,t){const s=this._boundsMin,i=this._boundsMax;for(let r=0;r<t;r++){const a=e[r*4+0],n=e[r*4+1],o=e[r*4+2];s.minimizeInPlaceFromFloats(a,n,o),i.maximizeInPlaceFromFloats(a,n,o)}this._host?this._host.expandBounds(s,i):this.setBoundingInfo(new Se(s,i))}_refreshActiveRanges(){const e=[];this._environmentRange&&e.push({offset:this._environmentRange.offset,count:this._environmentRange.count});for(const t of this._leafNodes){if(t.activeLod===void 0)continue;const s=t.lods[String(t.activeLod)];if(!s)continue;const i=this._residency?.offset(s.file);i!==void 0&&e.push({offset:i+s.offset,count:s.count})}this._sinkSetActiveRanges(O._CoalesceRanges(e))}static _CoalesceRanges(e){if(e.length<=1)return e;const t=e.slice().sort((i,r)=>i.offset-r.offset),s=[{offset:t[0].offset,count:t[0].count}];for(let i=1;i<t.length;i++){const r=s[s.length-1],a=t[i],n=r.offset+r.count;if(a.offset<=n){const o=Math.max(n,a.offset+a.count);r.count=o-r.offset}else s.push({offset:a.offset,count:a.count})}return s}async _unzipAsync(e){let t=this._streamOptions.fflate;t||(typeof window.fflate>"u"&&await le.LoadScriptAsync(this._streamOptions.deflateURL??"https://unpkg.com/fflate/umd/index.js"),t=window.fflate);const s=t.unzipSync(e),i=new Map;for(const[r,a]of Object.entries(s))i.set(r,a);return i}}const yt=32768,ne=.28209479177387814;let de=null,we=null;function Mt(g,e,t){const s=new Uint8Array(g),i=new Uint32Array(g.slice(0,12)),r=i[2],a=s[12],n=s[13],o=s[14],l=s[15],u=i[1];if(l||i[0]!=1347635022||u<2||u>4)return new Promise(_=>{_({mode:3,data:new ArrayBuffer(0),hasVertexColors:!1})});const d=32,h=new ArrayBuffer(d*r),c=1/(1<<n),m=new Int32Array(1),S=new Uint8Array(m.buffer),C=function(_,b){return S[0]=_[b+0],S[1]=_[b+1],S[2]=_[b+2],S[3]=_[b+2]&128?255:0,m[0]*c};let f=16;const x=new Float32Array(h),p=new Float32Array(h),y=new Uint8ClampedArray(h),M=new Uint8ClampedArray(h);for(let _=0;_<r;_++)x[_*8+0]=C(s,f+0),x[_*8+1]=C(s,f+3),x[_*8+2]=C(s,f+6),f+=9;for(let _=0;_<r;_++){for(let b=0;b<3;b++){const v=(s[f+r+_*3+b]-127.5)/(.15*255);y[_*32+24+b]=J.Clamp((.5+ne*v)*255,0,255)}y[_*32+24+3]=s[f+_]}f+=r*4;for(let _=0;_<r;_++)p[_*8+3+0]=Math.exp(s[f+0]/16-10),p[_*8+3+1]=Math.exp(s[f+1]/16-10),p[_*8+3+2]=Math.exp(s[f+2]/16-10),f+=3;if(u>=3){const _=Math.SQRT1_2;for(let b=0;b<r;b++){const w=[s[f+0],s[f+1],s[f+2],s[f+3]],v=w[0]+(w[1]<<8)+(w[2]<<16)+(w[3]<<24),D=511,L=[],q=v>>>30;let P=v,R=0;for(let k=3;k>=0;--k)if(k!==q){const I=P&D,z=P>>>9&1;P=P>>>10,L[k]=_*(I/D),z===1&&(L[k]=-L[k]),R+=L[k]*L[k]}const A=1-R;L[q]=Math.sqrt(Math.max(A,0));const B=[3,0,1,2];for(let k=0;k<4;k++)M[b*32+28+k]=Math.round(127.5+L[B[k]]*127.5);f+=4}}else for(let _=0;_<r;_++){const b=s[f+0],w=s[f+1],v=s[f+2],D=b/127.5-1,L=w/127.5-1,q=v/127.5-1;M[_*32+28+1]=b,M[_*32+28+2]=w,M[_*32+28+3]=v;const P=1-(D*D+L*L+q*q);M[_*32+28+0]=127.5+Math.sqrt(P<0?0:P)*127.5,f+=3}if(a){const b=((a+1)*(a+1)-1)*3,w=Math.ceil(b/16);let v=f;const L=e.getEngine().getCaps().maxTextureSize,q=Math.ceil(r/L),P=ge(w,q*L*4*4);for(let R=0;R<r;R++)for(let A=0;A<b;A++){const B=s[v++],k=Math.floor(A/16),I=P[k],z=A%16,W=R*16;I[z+W]=B}return new Promise(R=>{R({mode:0,data:h,hasVertexColors:!1,sh:P,shDegree:a,trainedWithAntialiasing:!!o})})}return new Promise(_=>{_({mode:0,data:h,hasVertexColors:!1,trainedWithAntialiasing:!!o})})}async function vt(g){if(de&&we===g)return await de;const e=ze(`import createSpzModule from '${g}';
         const module = await createSpzModule();
         const returnedValue = module;`);return we=g,de=e,await e}function*wt(g,e,t=!1){const s=g.numPoints,i=32,r=new ArrayBuffer(i*s),a=new Float32Array(r),n=new Uint8Array(r),o=g.positions,l=g.scales,u=g.colors,d=g.alphas,h=g.rotations;let c=null;const m=g.shDegree;let S=null,C=0,f=null,x=null,p=null;if(m>0&&g.sh.length>0){C=((m+1)*(m+1)-1)*3;const b=Math.ceil(C/16),v=e.getEngine().getCaps().maxTextureSize,D=Math.ceil(s/v);c=ge(b,D*v*4*4),f=new Int32Array(b),x=new Int32Array(b);for(let L=0;L<b;L++)f[L]=L*16,x[L]=Math.min((L+1)*16,C);p=c,S=g.sh}for(let _=0;_<s;_++){const b=_*8,w=_*32,v=_*3,D=_*4;a[b+0]=o[v+0],a[b+1]=o[v+1],a[b+2]=o[v+2],a[b+3]=Math.exp(l[v+0]),a[b+4]=Math.exp(l[v+1]),a[b+5]=Math.exp(l[v+2]);const L=(.5+ne*u[v+0])*255,q=(.5+ne*u[v+1])*255,P=(.5+ne*u[v+2])*255;n[w+24]=L<=0?0:L>=255?255:L+.5|0,n[w+25]=q<=0?0:q>=255?255:q+.5|0,n[w+26]=P<=0?0:P>=255?255:P+.5|0,n[w+27]=1/(1+Math.exp(-d[_]))*255+.5|0;const R=h[D+3]*127.5+127.5,A=h[D+0]*127.5+127.5,B=h[D+1]*127.5+127.5,k=h[D+2]*127.5+127.5;if(n[w+28]=R<=0?0:R>=255?255:R+.5|0,n[w+29]=A<=0?0:A>=255?255:A+.5|0,n[w+30]=B<=0?0:B>=255?255:B+.5|0,n[w+31]=k<=0?0:k>=255?255:k+.5|0,S&&p&&f&&x){const I=_*C,z=_*16;for(let W=0;W<p.length;W++){const j=p[W],G=f[W],H=x[W];for(let V=G;V<H;V++){const K=S[I+V]*128+128;j[z+V-G]=K<=0?0:K>=255?255:K+.5|0}}}_%yt===0&&t&&(yield)}let y,M;if(g.extensions)for(const _ of g.extensions){const b=_;if(b.safeOrbitRadiusMin!==void 0){y=b.safeOrbitRadiusMin,M=[b.safeOrbitElevationMin,b.safeOrbitElevationMax];break}}return{mode:0,data:r,hasVertexColors:!1,sh:c!==null?c:void 0,shDegree:m>0?m:void 0,trainedWithAntialiasing:!!g.antialiased,safeOrbitCameraRadiusMin:y,safeOrbitCameraElevationMinMax:M}}async function Rt(g,e){return await Fe(wt(g,e,!0),De())}class N{constructor(e={}){this.name=ce.name,this._assetContainer=null,this.extensions=ce.extensions,this._loadingOptions={...N._DefaultLoadingOptions,...e}}createPlugin(e){return new N(e[ce.name])}async importMeshAsync(e,t,s,i,r,a){const n=this._tryCreateLODStream(t,s,i);return n?{meshes:[n],particleSystems:[],skeletons:[],animationGroups:[],transformNodes:[],geometries:[],lights:[],spriteManagers:[]}:await this._parseAsync(e,t,s,i).then(o=>({meshes:o,particleSystems:[],skeletons:[],animationGroups:[],transformNodes:[],geometries:[],lights:[],spriteManagers:[]}))}_tryCreateLODStream(e,t,s){if(typeof t!="string")return null;let i;try{i=JSON.parse(t)}catch{return null}return O.IsLODMetadata(i)?e._executeWithBlockedEntityCollection(!!this._assetContainer,()=>{const r=new O("GaussianSplattingStream",i,s,e,{deflateURL:this._loadingOptions.deflateURL,fflate:this._loadingOptions.fflate});return r._parentContainer=this._assetContainer,r}):null}static _BuildPointCloud(e,t,s){return t.byteLength?e._executeWithBlockedEntityCollection(!!s,()=>{const i=new Uint8Array(t),r=new Float32Array(t),a=32,n=i.length/a,o=new Float32Array(n*3),l=new Float32Array(n*4);for(let c=0;c<n;c++)o[c*3+0]=r[8*c+0],o[c*3+1]=r[8*c+1],o[c*3+2]=r[8*c+2],l[c*4+0]=i[a*c+24+0]/255,l[c*4+1]=i[a*c+24+1]/255,l[c*4+2]=i[a*c+24+2]/255,l[c*4+3]=1;const u=new _e("PointCloud",e);u._parentContainer=s;const d=new pe;d.positions=o,d.colors=l,d.applyToMesh(u),u.geometry._parentContainer=s,s?.geometries.push(u.geometry);const h=new Be("point cloud material",e);return h.emissiveColor=Ee.White(),h.disableLighting=!0,h.pointsCloud=!0,h.pointSize=1,h._parentContainer=s,s?.materials.push(h),u.material=h,u}):null}static _BuildMesh(e,t){const s=new _e("PLYMesh",e),i=new Uint8Array(t.data),r=new Float32Array(t.data),a=32,n=i.length/a,o=[],l=new pe;for(let u=0;u<n;u++){const d=r[8*u+0],h=r[8*u+1],c=r[8*u+2];o.push(d,h,c)}if(t.hasVertexColors){const u=new Float32Array(n*4);for(let d=0;d<n;d++){const h=i[a*d+24+0]/255,c=i[a*d+24+1]/255,m=i[a*d+24+2]/255;u[d*4+0]=h,u[d*4+1]=c,u[d*4+2]=m,u[d*4+3]=1}l.colors=u}return l.positions=o,l.indices=t.faces,l.applyToMesh(s),s}async _unzipWithFFlateAsync(e){let t=this._loadingOptions.fflate;t||(typeof window.fflate>"u"&&await le.LoadScriptAsync(this._loadingOptions.deflateURL??"https://unpkg.com/fflate/umd/index.js"),t=window.fflate);const{unzipSync:s}=t,i=s(e),r=new Map;for(const[a,n]of Object.entries(i))r.set(a,n);return r}_parseAsync(e,t,s,i){const r=[],a=x=>{t._executeWithBlockedEntityCollection(!!this._assetContainer,()=>{const p=this._loadingOptions.gaussianSplattingMesh??new ee("GaussianSplatting",null,t,this._loadingOptions.keepInRam,this._loadingOptions.needsRotationScaleTextures);p._parentContainer=this._assetContainer,r.push(p),x.sogTextures?p.setSogTextureData(x.sogTextures):p.updateData(x.data,x.sh,{flipY:!1},void 0,x.shDegree),p.scaling.y*=-1,p.computeWorldMatrix(!0),p.safeOrbitCameraLimits=N._ExtractSafeOrbitLimits(x)})},n=t.getEngine();let o=this._loadingOptions.useSogTextures;o&&!n.isWebGPU&&n.version<2&&(E.Warn("SPLATFileLoader: useSogTextures requires WebGL2 or WebGPU. Falling back to CPU path."),o=!1);const l=o?ae:We;if(typeof s=="string"){const x=JSON.parse(s);if(x&&x.means&&x.scales&&x.quats&&x.sh0)return new Promise((p,y)=>{l(x,i,t).then(M=>{a(M),p(r)}).catch(M=>{y(new Error("Failed to parse SOG data.",{cause:M}))})})}const u=s instanceof ArrayBuffer?new Uint8Array(s):s;if(u[0]===80&&u[1]===75)return new Promise((x,p)=>{this._unzipWithFFlateAsync(u).then(y=>{l(y,i,t).then(M=>{a(M),x(r)}).catch(M=>{p(new Error("Failed to parse SOG zip data.",{cause:M}))})})});const d=x=>{N._ConvertPLYToSplat(s).then(p=>{switch(p.mode){case 0:t._executeWithBlockedEntityCollection(!!this._assetContainer,()=>{const y=this._loadingOptions.gaussianSplattingMesh??new ee("GaussianSplatting",null,t,this._loadingOptions.keepInRam,this._loadingOptions.needsRotationScaleTextures);switch(y._parentContainer=this._assetContainer,r.push(y),y.updateData(p.data,p.sh,{flipY:!1},void 0,p.shDegree),y.scaling.y*=-1,p.chirality==="RightHanded"&&(y.scaling.y*=-1),p.upAxis){case"X":y.rotation=new F(0,0,Math.PI/2);break;case"Y":y.rotation=new F(0,0,Math.PI);break;case"Z":y.rotation=new F(-Math.PI/2,Math.PI,0);break}y.computeWorldMatrix(!0),y.safeOrbitCameraLimits=N._ExtractSafeOrbitLimits(p)});break;case 1:{const y=N._BuildPointCloud(t,p.data,this._assetContainer);y&&r.push(y);break}case 2:t._executeWithBlockedEntityCollection(!!this._assetContainer,()=>{if(p.faces)r.push(N._BuildMesh(t,p));else throw new Error("PLY mesh doesn't contain face informations.")});break;default:throw new Error("Unsupported Splat mode")}this.applyAutoCameraLimits(N._ExtractSafeOrbitLimits(p),t),x(r)})},h=u[0]===31&&u[1]===139,c=u[0]===78&&u[1]===71&&u[2]===83&&u[3]===80;if(!h&&!c)return new Promise(x=>{d(x)});const m=(x,p)=>{t._executeWithBlockedEntityCollection(!!this._assetContainer,()=>{const y=this._loadingOptions.gaussianSplattingMesh??new ee("GaussianSplatting",null,t,this._loadingOptions.keepInRam,this._loadingOptions.needsRotationScaleTextures);if(x.trainedWithAntialiasing){const _=y.material;_.kernelSize=.1,_.compensation=!0}y._parentContainer=this._assetContainer,r.push(y),y.updateData(x.data,x.sh,{flipY:!1},void 0,x.shDegree),this._loadingOptions.flipY||(y.scaling.y*=-1,y.computeWorldMatrix(!0));const M=N._ExtractSafeOrbitLimits(x);y.safeOrbitCameraLimits=M,this.applyAutoCameraLimits(M,t)}),p(r)};if(this._loadingOptions.spzLibraryUrl)return vt(this._loadingOptions.spzLibraryUrl).then(x=>{const p=x.loadSpzFromBuffer(new Uint8Array(s),{to:x.CoordinateSystem.RUB});return Rt(p,t).then(y=>new Promise(M=>{m(y,M)}))});if(c)return Promise.reject(new Error("SPZ V4+ files (NGSP format) are not supported by the native fallback loader. Please provide a valid 'spzLibraryUrl' in the loading options to use the WASM-based SPZ library, or ensure WebAssembly is available in your environment."));const S=new ReadableStream({start(x){x.enqueue(new Uint8Array(s)),x.close()}}),C=new DecompressionStream("gzip"),f=S.pipeThrough(C);return new Promise(x=>{new Response(f).arrayBuffer().then(p=>{Mt(p,t,this._loadingOptions).then(y=>{m(y,x)})}).catch(()=>{d(x)})})}static _ExtractSafeOrbitLimits(e){return e.safeOrbitCameraRadiusMin===void 0&&e.safeOrbitCameraElevationMinMax===void 0?null:{radiusMin:e.safeOrbitCameraRadiusMin,elevationMinMax:e.safeOrbitCameraElevationMinMax}}applyAutoCameraLimits(e,t){if(!(this._loadingOptions.disableAutoCameraLimits||!e)&&t.activeCamera?.getClassName()==="ArcRotateCamera"){const s=t.activeCamera;e.elevationMinMax&&(s.lowerBetaLimit=Math.PI*.5-e.elevationMinMax[1],s.upperBetaLimit=Math.PI*.5-e.elevationMinMax[0]),e.radiusMin&&(s.lowerRadiusLimit=e.radiusMin)}}loadAssetContainerAsync(e,t,s){const i=new Oe(e);return this._assetContainer=i,this.importMeshAsync(null,e,t,s).then(r=>{for(const a of r.meshes)i.meshes.push(a);return this._assetContainer=null,i}).catch(r=>{throw this._assetContainer=null,r})}loadAsync(e,t,s){return this.importMeshAsync(null,e,t,s).then(()=>{})}static _ConvertPLYToSplat(e){const t=new Uint8Array(e),s=new TextDecoder().decode(t.slice(0,1024*10)),i=`end_header
`,r=s.indexOf(i);if(r<0||!s)return new Promise(M=>{M({mode:0,data:e,rawSplat:!0})});const a=parseInt(/element vertex (\d+)\n/.exec(s)[1]),n=/element face (\d+)\n/.exec(s);let o=0;n&&(o=parseInt(n[1]));const l=/element chunk (\d+)\n/.exec(s);let u=0;l&&(u=parseInt(l[1]));let d=0,h=0;const c={double:8,int:4,uint:4,float:4,short:2,ushort:2,uint16:2,uchar:1,list:0},m={Vertex:0,Chunk:1,SH:2,Float_Tuple:3,Float:4,Uchar:5};let S=m.Chunk;const C=[],f=s.slice(0,r).split(`
`),x={};for(const M of f)if(M.startsWith("property ")){const[,_,b]=M.split(" ");if(S==m.Chunk)h+=c[_];else if(S==m.Vertex)C.push({name:b,type:_,offset:d}),d+=c[_];else if(S==m.SH)C.push({name:b,type:_,offset:d});else if(S==m.Float_Tuple){const w=new DataView(e,h,c.float*2);x.safeOrbitCameraElevationMinMax=[w.getFloat32(0,!0),w.getFloat32(4,!0)]}else if(S==m.Float){const w=new DataView(e,h,c.float);x.safeOrbitCameraRadiusMin=w.getFloat32(0,!0)}else if(S==m.Uchar){const w=new DataView(e,h,c.uchar);b=="up_axis"?x.upAxis=w.getUint8(0)==0?"X":w.getUint8(0)==1?"Y":"Z":b=="chirality"&&(x.chirality=w.getUint8(0)==0?"LeftHanded":"RightHanded")}c[_]||E.Warn(`Unsupported property type: ${_}.`)}else if(M.startsWith("element ")){const[,_]=M.split(" ");_=="chunk"?S=m.Chunk:_=="vertex"?S=m.Vertex:_=="sh"?S=m.SH:_=="safe_orbit_camera_elevation_min_max_radians"?S=m.Float_Tuple:_=="safe_orbit_camera_radius_min"?S=m.Float:(_=="up_axis"||_=="chirality")&&(S=m.Uchar)}const p=d,y=h;return ee.ConvertPLYWithSHToSplatAsync(e).then(async M=>{const _=new DataView(e,r+i.length);let b=y*u+p*a;const w=[];if(o)for(let A=0;A<o;A++){const B=_.getUint8(b);if(B==3){b+=1;for(let k=0;k<B;k++){const I=_.getUint32(b+(2-k)*4,!0);w.push(I)}b+=12}}if(u)return await new Promise(A=>{A({mode:0,data:M.buffer,sh:M.sh,shDegree:M.shDegree,faces:w,hasVertexColors:!1,compressed:!0,rawSplat:!1})});let v=0,D=0;const L=["x","y","z","scale_0","scale_1","scale_2","opacity","rot_0","rot_1","rot_2","rot_3"],q=["red","green","blue","f_dc_0","f_dc_1","f_dc_2"];for(let A=0;A<C.length;A++){const B=C[A];L.includes(B.name)&&v++,q.includes(B.name)&&D++}const P=v==L.length&&D>=3,R=o?2:P?0:1;return await new Promise(A=>{A({...x,mode:R,data:M.buffer,sh:M.sh,shDegree:M.shDegree,faces:w,hasVertexColors:!!D,compressed:!1,rawSplat:!1})})})}}N._DefaultLoadingOptions={keepInRam:!1,flipY:!1,needsRotationScaleTextures:!1,spzLibraryUrl:typeof WebAssembly=="object"?"https://unpkg.com/@adobe/spz@0.2.2/dist/spz.js":void 0};let Re=!1;function ns(){Re||(Re=!0,Pe(new N))}export{ns as RegisterSPLATFileLoader,N as SPLATFileLoader};
