import{b6 as e}from"./index-7F-5godA.js";import{s as r}from"./sceneUboDeclaration-DygEKXI0.js";import{helperFunctionsWGSL as i}from"./helperFunctions-5ADlqxgM.js";import{l as t,s as l}from"./shadowsFragmentFunctions-BCs2ybsM.js";import{l as s}from"./lightsFragmentFunctions-BmSjDObq.js";import{c as f,a as m}from"./clipPlaneFragment-C6BRDrST.js";import{logDepthDeclarationWGSL as c}from"./logDepthDeclaration-DKx5HmMv.js";import{fogFragmentDeclarationWGSL as d}from"./fogFragmentDeclaration-Dcl4J1dI.js";import{lightFragmentWGSL as g}from"./lightFragment-SEn7q8gl.js";import{l as S}from"./logDepthFragment-BlsAtAhD.js";import{f as u}from"./fogFragment-DrdMhpXE.js";import"./clusteredLightingFunctions-DYjZfurK.js";const a="shadowOnlyPixelShader",o=`#include<sceneUboDeclaration>
uniform alpha: f32;uniform shadowColor: vec3f;
#define ADDITIONAL_UBO_DECLARATION
varying vPositionW: vec3f;
#ifdef NORMAL
varying vNormalW: vec3f;
#endif
#include<helperFunctions>
#include<lightUboDeclaration>[0..maxSimultaneousLights]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying vViewDepth: f32;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var viewDirectionW: vec3f=normalize(scene.vEyePosition.xyz-fragmentInputs.vPositionW);
#ifdef NORMAL
var normalW: vec3f=normalize(fragmentInputs.vNormalW);
#else
var normalW: vec3f= vec3f(1.0,1.0,1.0);
#endif
var diffuseBase: vec3f= vec3f(0.,0.,0.);var info: lightingInfo;var shadow: f32=1.;var glossiness: f32=0.;var aggShadow: f32=0.;var numLights: f32=0.;
#include<lightFragment>[0..1]
#define CUSTOM_FRAGMENT_BEFORE_LIGHT_COMPOSITION
var color: vec4f= vec4f(uniforms.shadowColor,(1.0-clamp(shadow,0.,1.))*uniforms.alpha);
#include<logDepthFragment>
#include<fogFragment>
fragmentOutputs.color=color;
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStoreWGSL[a]||(e.ShadersStoreWGSL[a]=o);const h=[r,i,t,s,l,f,c,d,m,g,S,u];for(const n of h)e.IncludesShadersStoreWGSL[n.name]||(e.IncludesShadersStoreWGSL[n.name]=n.shader);const A={name:a,shader:o};export{A as shadowOnlyPixelShaderWGSL};
