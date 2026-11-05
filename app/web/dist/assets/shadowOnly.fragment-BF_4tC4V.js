import{b6 as e}from"./index-D5UMdsmS.js";import{s as a}from"./openpbrTransmissionLayerData-CPM9yfLu.js";import{s as r}from"./sceneUboDeclaration-2SSscJQC.js";import{helperFunctions as t}from"./helperFunctions-CQ0kP9_C.js";import{l,a as m}from"./lightUboDeclaration-Dxk85YoE.js";import{lightsFragmentFunctions as s}from"./lightsFragmentFunctions-DFTH5uRW.js";import{s as c}from"./shadowsFragmentFunctions-PTQLxFL0.js";import{clipPlaneFragmentDeclaration as d}from"./clipPlaneFragmentDeclaration-DdUYSsHJ.js";import{logDepthDeclaration as f}from"./logDepthDeclaration-XFxSzGT-.js";import{f as g,a as h}from"./fogFragment-BLp8bSEA.js";import{clipPlaneFragment as p}from"./clipPlaneFragment-BUXEUK90.js";import{lightFragment as F}from"./lightFragment-Brpzvjb-.js";import{l as u}from"./logDepthFragment-EiZlaGDV.js";import{i as _}from"./imageProcessingCompatibility-Bd5SE3Mh.js";import"./clusteredLightingFunctions-I2Xa_1HB.js";import"./objectIdFunctions-C9puPRQo.js";const i="shadowOnlyPixelShader",n=`precision highp float;
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
