import{b6 as r}from"./index-Ctl_JKww.js";import{helperFunctions as o}from"./helperFunctions-laQcfMtV.js";import{i as t,h as a}from"./hdrFilteringFunctions-CGoSA5Ra.js";import{p as c}from"./pbrBRDFFunctions-B4qQsc-5.js";const i="hdrFilteringPixelShader",n=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
uniform float alphaG;uniform samplerCube inputTexture;uniform vec2 vFilteringInfo;uniform float hdrScale;varying vec3 direction;void main() {vec3 color=radiance(alphaG,inputTexture,direction,vFilteringInfo);gl_FragColor=vec4(color*hdrScale,1.0);}`;r.ShadersStore[i]||(r.ShadersStore[i]=n);const l=[o,t,c,a];for(const e of l)r.IncludesShadersStore[e.name]||(r.IncludesShadersStore[e.name]=e.shader);const h={name:i,shader:n};export{h as hdrFilteringPixelShader};
