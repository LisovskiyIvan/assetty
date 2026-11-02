import{b6 as e}from"./index-DwYVRG0U.js";import{s as a}from"./openpbrTransmissionLayerData-EPLobTP5.js";import{s as r}from"./sceneUboDeclaration-vxxlNNzF.js";import{helperFunctions as t}from"./helperFunctions-DWniefuq.js";import{l,a as m}from"./lightUboDeclaration-kynNakhA.js";import{lightsFragmentFunctions as s}from"./lightsFragmentFunctions-Dye8UP45.js";import{s as c}from"./shadowsFragmentFunctions-CVGSykdm.js";import{clipPlaneFragmentDeclaration as d}from"./clipPlaneFragmentDeclaration-CTT-PgKM.js";import{logDepthDeclaration as f}from"./logDepthDeclaration-2OBpBU7x.js";import{f as g,a as h}from"./fogFragment-DHhAWQWv.js";import{clipPlaneFragment as p}from"./clipPlaneFragment-r4rZtMcD.js";import{lightFragment as F}from"./lightFragment-BlJvFNYC.js";import{l as u}from"./logDepthFragment--DB0nbTg.js";import{i as _}from"./imageProcessingCompatibility-Bpk2r9mR.js";import"./clusteredLightingFunctions-C1Vsi_mq.js";import"./objectIdFunctions-DZXusK9E.js";const i="shadowOnlyPixelShader",n=`precision highp float;
#include<__decl__sceneFragment>
uniform float alpha;uniform vec3 shadowColor;
#define ADDITIONAL_FRAGMENT_DECLARATION
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#include<helperFunctions>
#include<__decl__lightFragment>[0..maxSimultaneousLights]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#include<clipPlaneFragmentDeclaration>
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying float vViewDepth;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
#ifdef NORMAL
vec3 normalW=normalize(vNormalW);
#else
vec3 normalW=vec3(1.0,1.0,1.0);
#endif
vec3 diffuseBase=vec3(0.,0.,0.);lightingInfo info;float shadow=1.;float glossiness=0.;float aggShadow=0.;float numLights=0.;
#include<lightFragment>[0..1]
#define CUSTOM_FRAGMENT_BEFORE_LIGHT_COMPOSITION
vec4 color=vec4(shadowColor,(1.0-clamp(shadow,0.,1.))*alpha);
#include<logDepthFragment>
#include<fogFragment>
gl_FragColor=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[i]||(e.ShadersStore[i]=n);const v=[a,r,t,l,m,s,c,d,f,g,p,F,u,h,_];for(const o of v)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);const U={name:i,shader:n};export{U as shadowOnlyPixelShader};
