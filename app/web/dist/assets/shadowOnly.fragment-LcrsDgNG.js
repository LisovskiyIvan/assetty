import{b6 as e}from"./index-q74-en5_.js";import{s as a}from"./openpbrTransmissionLayerData-Cl84q_X0.js";import{s as r}from"./sceneUboDeclaration-slK4gYa3.js";import{helperFunctions as t}from"./helperFunctions-B-VxibnW.js";import{l,a as m}from"./lightUboDeclaration-DrBZqIFt.js";import{lightsFragmentFunctions as s}from"./lightsFragmentFunctions-B3vNf0CZ.js";import{s as c}from"./shadowsFragmentFunctions-Ch_18bt_.js";import{clipPlaneFragmentDeclaration as d}from"./clipPlaneFragmentDeclaration-BZO9gGnG.js";import{logDepthDeclaration as f}from"./logDepthDeclaration-BZW6MKGM.js";import{f as g,a as h}from"./fogFragment-ByvXQDdS.js";import{clipPlaneFragment as p}from"./clipPlaneFragment-B2tlmmOD.js";import{lightFragment as F}from"./lightFragment-B9m5_8KN.js";import{l as u}from"./logDepthFragment-CCmZAaAr.js";import{i as _}from"./imageProcessingCompatibility-DOdgSG9V.js";import"./clusteredLightingFunctions-LQptb7ft.js";import"./objectIdFunctions-BiLWpbC2.js";const i="shadowOnlyPixelShader",n=`precision highp float;
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
