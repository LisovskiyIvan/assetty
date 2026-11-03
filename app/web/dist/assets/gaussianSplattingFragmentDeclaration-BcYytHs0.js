import{b6 as e}from"./index-CR91ZdlI.js";import"./logDepthFragment-CkSJlqKk.js";import"./fogFragment-2eeiaM_l.js";const o="gaussianSplattingFragmentDeclaration",n=`fn gaussianColor(inColor: vec4f,inPosition: vec2f)->vec4f
{var A : f32=-dot(inPosition,inPosition);if (A>-4.0)
{var B: f32=exp(A)*inColor.a;
#include<logDepthFragment>
var color: vec4f=vec4f(inColor.rgb,B);
#ifdef FOG
#include<fogFragment>
#endif
return color;} else {return vec4f(0.0);}}
`;e.IncludesShadersStoreWGSL[o]||(e.IncludesShadersStoreWGSL[o]=n);const a={name:o,shader:n};export{a as gaussianSplattingFragmentDeclarationWGSL};
