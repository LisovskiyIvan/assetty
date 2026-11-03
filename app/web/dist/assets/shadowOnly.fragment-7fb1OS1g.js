import{b6 as e}from"./index-Crtbj3yS.js";import{s as a}from"./openpbrTransmissionLayerData-B76tk0mN.js";import{s as r}from"./sceneUboDeclaration-yOkOnJ_0.js";import{helperFunctions as t}from"./helperFunctions-isskH2CR.js";import{l,a as m}from"./lightUboDeclaration-BJYqlDq2.js";import{lightsFragmentFunctions as s}from"./lightsFragmentFunctions-DnD_Xi6Z.js";import{s as c}from"./shadowsFragmentFunctions-BPig84VD.js";import{clipPlaneFragmentDeclaration as d}from"./clipPlaneFragmentDeclaration-DGWUjvnI.js";import{logDepthDeclaration as f}from"./logDepthDeclaration-C1I_TyuF.js";import{f as g,a as h}from"./fogFragment-C6d7PkFo.js";import{clipPlaneFragment as p}from"./clipPlaneFragment-Cr1olitu.js";import{lightFragment as F}from"./lightFragment-DzIeUkVY.js";import{l as u}from"./logDepthFragment-iyjhaP3u.js";import{i as _}from"./imageProcessingCompatibility-B5zCMBU2.js";import"./clusteredLightingFunctions-CDSrBTOM.js";import"./objectIdFunctions-Bzs_g-nn.js";const i="shadowOnlyPixelShader",n=`precision highp float;
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
